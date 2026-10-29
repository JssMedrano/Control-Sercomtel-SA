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

  let client;
  let mongoSaved = false;
  let discordSent = false;
  try {
    const record = {
      ...request.body,
      createdAt: new Date(request.body.createdAt || Date.now()),
      insertedAt: new Date(),
    };

    if (process.env.MONGODB_URI) {
      try {
        client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        const database = client.db(process.env.MONGODB_DB || "retencion_sercomtel");
        await database.collection("attendances").insertOne(record);
        mongoSaved = true;
      } catch (error) {
        console.error("MongoDB rechazó el atendimiento.", error);
      } finally {
        if (client) {
          await client.close();
          client = null;
        }
      }
    }

    if (process.env.DISCORD_WEBHOOK_URL) {
      const statusLabels = { retained: "RETENIDO", cancelled: "CANCELADO", pending: "PENDIENTE" };
      const discordResponse = await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "Retención · Atendimientos",
          embeds: [{
            title: `${statusLabels[request.body.status]} · ${request.body.name || "Sin nombre"}`,
            description: request.body.annotations || "Sin anotaciones.",
            color: request.body.status === "retained" ? 5814783 : request.body.status === "cancelled" ? 16721842 : 15105570,
            fields: [
              { name: "Fecha", value: request.body.date, inline: true },
              { name: "Protocolo", value: request.body.protocol || "—", inline: true },
              { name: "Inscrição", value: request.body.registration || "—", inline: true },
              { name: "Contato", value: request.body.contact || "—", inline: true },
              { name: "CPF/CNPJ", value: request.body.document || "—", inline: true },
              { name: "VOX", value: request.body.vox || "—", inline: true },
            ],
            timestamp: record.createdAt.toISOString(),
          }],
        }),
      });
      discordSent = discordResponse.ok;
      if (!discordSent) console.error("Discord rechazó el atendimiento.", await discordResponse.text());
    }

    if (!mongoSaved && !discordSent) {
      return response.status(503).json({ error: "MongoDB y Discord no están configurados o rechazaron el registro." });
    }
    return response.status(201).json({ saved: mongoSaved, discordSent });
  } catch (error) {
    console.error("No se pudo guardar el atendimiento en MongoDB.", error);
    return response.status(502).json({ error: "No se pudo guardar o enviar el atendimiento." });
  } finally {
    if (client) await client.close();
  }
}
