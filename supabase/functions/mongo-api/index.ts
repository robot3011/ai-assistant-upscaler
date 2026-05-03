// NovaMind MongoDB API
// Single edge function exposing CRUD over MongoDB Atlas for conversations + messages.
// Auth still uses Lovable Cloud (Supabase Auth) — JWT is verified here per request.

import { MongoClient, ObjectId } from "npm:mongodb@6.10.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MONGODB_URI = Deno.env.get("MONGODB_URI")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Cache the client across invocations
let cachedClient: MongoClient | null = null;
let indexesEnsured = false;
async function getDb() {
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGODB_URI);
    await cachedClient.connect();
  }
  // Database name comes from the URI path; default to "novamind" if absent
  const db = cachedClient.db("novamind");
  if (!indexesEnsured) {
    try {
      await Promise.all([
        // Users: one document per signed-in user
        db.collection("users").createIndex(
          { user_id: 1 },
          { name: "user_id_unique", unique: true }
        ),
        db.collection("users").createIndex(
          { email: 1 },
          { name: "email_idx" }
        ),
        // Conversations: fast per-user listing sorted by recency
        db.collection("conversations").createIndex(
          { user_id: 1, updated_at: -1 },
          { name: "user_updated_idx" }
        ),
        db.collection("conversations").createIndex(
          { updated_at: -1 },
          { name: "updated_idx" }
        ),
        // Messages: fast per-conversation listing in chronological order
        db.collection("messages").createIndex(
          { conversation_id: 1, created_at: 1 },
          { name: "conv_time_idx" }
        ),
        db.collection("messages").createIndex(
          { user_id: 1, created_at: -1 },
          { name: "user_time_idx" }
        ),
        // Admin stats: counting generated images
        db.collection("messages").createIndex(
          { kind: 1 },
          { name: "kind_idx" }
        ),
      ]);
      indexesEnsured = true;
      console.log("MongoDB indexes ensured on novamind db");
    } catch (e) {
      console.error("Index creation warning:", e);
    }
  }
  return db;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getUserFromAuth(req: Request): Promise<{ id: string; isAdmin: boolean } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const token = auth.replace("Bearer ", "");
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData } = await supa.auth.getUser(token);
  if (!userData?.user) return null;

  // Check admin role via service role (bypasses RLS)
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: roleData } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  const isAdmin = (roleData || []).some((r: any) => r.role === "admin");
  return { id: userData.user.id, isAdmin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const user = await getUserFromAuth(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { action, payload = {} } = await req.json();
    const db = await getDb();
    const conversations = db.collection("conversations");
    const messages = db.collection("messages");

    switch (action) {
      // ---------- Health ----------
      case "ping": {
        const start = Date.now();
        await db.command({ ping: 1 });
        const collections = await db.listCollections().toArray();
        return json({
          ok: true,
          db: "novamind",
          latency_ms: Date.now() - start,
          collections: collections.map((c: any) => c.name),
          user_id: user.id,
          is_admin: user.isAdmin,
        });
      }

      // ---------- Conversations ----------
      case "listConversations": {
        const filter = user.isAdmin && payload.allUsers ? {} : { user_id: user.id };
        const docs = await conversations
          .find(filter)
          .sort({ updated_at: -1 })
          .limit(500)
          .toArray();
        return json({ items: docs.map(serialize) });
      }

      case "createConversation": {
        const now = new Date();
        const doc = {
          title: payload.title || "New chat",
          user_id: user.id,
          tone: payload.tone || "balanced",
          system_prompt: payload.system_prompt ?? null,
          created_at: now,
          updated_at: now,
        };
        const res = await conversations.insertOne(doc);
        return json({ item: serialize({ ...doc, _id: res.insertedId }) });
      }

      case "updateConversation": {
        const { id, updates } = payload;
        if (!id) return json({ error: "id required" }, 400);
        const set: Record<string, unknown> = { updated_at: new Date() };
        if (typeof updates?.title === "string") set.title = updates.title;
        if (typeof updates?.tone === "string") set.tone = updates.tone;
        if ("system_prompt" in (updates || {})) set.system_prompt = updates.system_prompt;
        await conversations.updateOne(
          { _id: new ObjectId(id), user_id: user.id },
          { $set: set }
        );
        return json({ ok: true });
      }

      case "deleteConversation": {
        const { id } = payload;
        if (!id) return json({ error: "id required" }, 400);
        const filter = user.isAdmin
          ? { _id: new ObjectId(id) }
          : { _id: new ObjectId(id), user_id: user.id };
        await conversations.deleteOne(filter);
        await messages.deleteMany({ conversation_id: id });
        return json({ ok: true });
      }

      // ---------- Messages ----------
      case "listMessages": {
        const { conversationId } = payload;
        if (!conversationId) return json({ error: "conversationId required" }, 400);
        // Verify ownership unless admin
        if (!user.isAdmin) {
          const conv = await conversations.findOne({
            _id: new ObjectId(conversationId),
            user_id: user.id,
          });
          if (!conv) return json({ error: "Not found" }, 404);
        }
        const docs = await messages
          .find({ conversation_id: conversationId })
          .sort({ created_at: 1 })
          .toArray();
        return json({ items: docs.map(serialize) });
      }

      case "addMessage": {
        const { conversationId, role, content, images = null, kind = "text" } = payload;
        if (!conversationId || !role) return json({ error: "missing fields" }, 400);
        // Verify ownership
        const conv = await conversations.findOne({
          _id: new ObjectId(conversationId),
          user_id: user.id,
        });
        if (!conv) return json({ error: "Not found" }, 404);

        const now = new Date();
        const doc = {
          conversation_id: conversationId,
          user_id: user.id,
          role,
          content: content ?? "",
          images,
          kind,
          created_at: now,
        };
        const res = await messages.insertOne(doc);
        await conversations.updateOne(
          { _id: new ObjectId(conversationId) },
          { $set: { updated_at: now } }
        );
        return json({ item: serialize({ ...doc, _id: res.insertedId }) });
      }

      case "deleteLastMessage": {
        const { conversationId } = payload;
        if (!conversationId) return json({ error: "conversationId required" }, 400);
        const last = await messages
          .find({ conversation_id: conversationId, user_id: user.id })
          .sort({ created_at: -1 })
          .limit(1)
          .toArray();
        if (last[0]) await messages.deleteOne({ _id: last[0]._id });
        return json({ ok: true });
      }

      // ---------- Admin ----------
      case "getStats": {
        if (!user.isAdmin) return json({ error: "Forbidden" }, 403);
        const [convs, msgs, imgs, recent] = await Promise.all([
          conversations.countDocuments({}),
          messages.countDocuments({}),
          messages.countDocuments({ kind: "generated_image" }),
          conversations.find({}).sort({ updated_at: -1 }).limit(20).toArray(),
        ]);
        // Distinct user count
        const userIds = await conversations.distinct("user_id");
        return json({
          users: userIds.length,
          conversations: convs,
          messages: msgs,
          generatedImages: imgs,
          recent: recent.map(serialize),
        });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("mongo-api error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function serialize(doc: any) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { id: _id?.toString?.() ?? _id, ...rest };
}
