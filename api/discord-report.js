const MAX_CONTENT_LENGTH = 6000;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método no permitido." });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return response.status(500).json({ error: "Discord no está configurado en Vercel." });
  }

  const { title, content } = request.body || {};
  if (
    typeof title !== "string" ||
    typeof content !== "string" ||
    !title.trim() ||
    !content.trim() ||
    content.length > MAX_CONTENT_LENGTH
  ) {
    return response.status(400).json({ error: "El informe no tiene un formato válido." });
  }

  const discordResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Retención · Reportes",
      embeds: [{
        title: title.trim(),
        description: content.trim(),
        color: 6724095,
        footer: { text: "Panel de retención" },
        timestamp: new Date().toISOString(),
      }],
    }),
  });

  if (!discordResponse.ok) {
    return response.status(502).json({ error: "Discord rechazó el informe." });
  }
  return response.status(204).end();
}
