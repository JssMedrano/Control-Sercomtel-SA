import { MongoClient } from "mongodb";

function validScript(script) {
  return script && typeof script.title === "string" && typeof script.text === "string"
    && script.title.trim() && script.text.trim()
    && script.title.length <= 60 && script.text.length <= 2000;
}

export default async function handler(request, response) {
  if (!process.env.MONGODB_URI) {
    return response.status(503).json({ error: "MongoDB no está configurado." });
  }

  let client;
  try {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const collection = client.db(process.env.MONGODB_DB || "retencion_sercomtel").collection("scripts");

    if (request.method === "GET") {
      const scripts = await collection.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
      return response.status(200).json({ scripts });
    }

    if (request.method === "POST") {
      if (!validScript(request.body)) {
        return response.status(400).json({ error: "El script no tiene un formato válido." });
      }
      const script = {
        id: request.body.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: request.body.title.trim(),
        text: request.body.text.trim(),
        createdAt: new Date(request.body.createdAt || Date.now()),
      };
      await collection.updateOne({ id: script.id }, { $set: script }, { upsert: true });
      return response.status(201).json({ saved: true, script });
    }

    if (request.method === "DELETE") {
      const id = request.query?.id;
      if (typeof id !== "string" || !id) {
        return response.status(400).json({ error: "El identificador del script es obligatorio." });
      }
      const result = await collection.deleteOne({ id });
      return response.status(200).json({ deleted: result.deletedCount === 1 });
    }

    response.setHeader("Allow", "GET, POST, DELETE");
    return response.status(405).json({ error: "Método no permitido." });
  } catch (error) {
    console.error("No se pudieron consultar o guardar los scripts.", error);
    return response.status(502).json({ error: "No se pudieron sincronizar los scripts." });
  } finally {
    if (client) await client.close();
  }
}
