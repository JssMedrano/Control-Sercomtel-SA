import { MongoClient } from "mongodb";

const MAX_CONTENT_LENGTH = 6000;
const statusLabels = { retained: "Retenido", cancelled: "Cancelado", pending: "Pendiente" };
const typeLabels = { fiber: "Fibras", phone: "Líneas" };

function isValidPeriod(value, type) {
  return typeof value === "string" && (
    type === "daily" ? /^\d{4}-\d{2}-\d{2}$/.test(value) : /^\d{4}-\d{2}$/.test(value)
  );
}

function buildReport(records, period, type) {
  const counts = records.reduce((result, record) => {
    result.total += 1;
    result.status[record.status] = (result.status[record.status] || 0) + 1;
    result.service[record.type] = (result.service[record.type] || 0) + 1;
    return result;
  }, { total: 0, status: {}, service: {} });
  const retention = counts.total ? ((counts.status.retained || 0) / counts.total * 100).toFixed(1) : "0.0";
  const title = type === "daily" ? `Informe diario · ${period}` : `Informe mensual · ${period}`;
  const details = records.slice(0, 100).map((record) =>
    `• ${record.name || "Sin nombre"} | ${statusLabels[record.status] || record.status} | ${typeLabels[record.type] || record.type} | Protocolo: ${record.protocol || "—"}`
  );
  return [
    `Atendimientos guardados en MongoDB: ${counts.total}`,
    `Retención: ${retention}%`,
    `Retenidos: ${counts.status.retained || 0} | Cancelados: ${counts.status.cancelled || 0} | Pendientes: ${counts.status.pending || 0}`,
    `Fibras: ${counts.service.fiber || 0} | Líneas: ${counts.service.phone || 0}`,
    details.length ? `\nDetalle:\n${details.join("\n")}` : "\nSin registros en el banco.",
  ].join("\n").slice(0, MAX_CONTENT_LENGTH);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método no permitido." });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const mongoUri = process.env.MONGODB_URI;
  const { period, type } = request.body || {};
  if (!webhookUrl || !mongoUri) {
    return response.status(500).json({ error: "MongoDB y Discord deben estar configurados en Vercel." });
  }
  if (!["daily", "monthly"].includes(type) || !isValidPeriod(period, type)) {
    return response.status(400).json({ error: "El período del informe no es válido." });
  }

  let client;
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    const records = await client
      .db(process.env.MONGODB_DB || "retencion_sercomtel")
      .collection("attendances")
      .find(type === "daily" ? { date: period } : { date: { $regex: `^${period}` } })
      .sort({ date: 1, createdAt: 1 })
      .toArray();
    const title = type === "daily" ? `Informe diario · ${period}` : `Informe mensual · ${period}`;
    const content = buildReport(records, period, type);
    const discordResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Retención · Reportes",
        embeds: [{
          title,
          description: content,
          color: 6724095,
          footer: { text: "Fuente: MongoDB · Panel de retención" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (!discordResponse.ok) {
      return response.status(502).json({ error: "Discord rechazó el informe." });
    }
    return response.status(204).end();
  } catch (error) {
    console.error("No se pudo consultar MongoDB o enviar el informe.", error);
    return response.status(502).json({ error: "No se pudo consultar MongoDB o enviar el informe." });
  } finally {
    if (client) await client.close();
  }
}
