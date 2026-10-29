import { MongoClient } from "mongodb";

const requiredFields = ["date", "status", "name", "protocol", "registration", "contact", "document", "vox", "annotations"];

function isValidRecord(record) {
  return record && requiredFields.every((field) => typeof record[field] === "string");
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método no permitido." });
  }

  if (!isValidRecord(request.body) || !["retained", "cancelled", "pending"].includes(request.body.status)) {
    return response.status(400).json({ error: "El registro de atendimiento no es válido." });
  }

  if (!process.env.MONGODB_URI) {
    return response.status(503).json({ error: "MongoDB no está configurado en Vercel." });
  }

  let client;
  try {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const database = client.db(process.env.MONGODB_DB || "retencion_sercomtel");
    await database.collection("attendances").insertOne({
      ...request.body,
      createdAt: new Date(request.body.createdAt || Date.now()),
      insertedAt: new Date(),
    });
    return response.status(201).json({ saved: true });
  } catch (error) {
    console.error("No se pudo guardar el atendimiento en MongoDB.", error);
    return response.status(502).json({ error: "No se pudo guardar el atendimiento." });
  } finally {
    if (client) await client.close();
  }
}
