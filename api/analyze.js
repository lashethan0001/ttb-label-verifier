// Vercel serverless function: proxies one label image to the Anthropic API.
// The API key lives only in the ANTHROPIC_API_KEY environment variable —
// it is never shipped to the browser.

const EXTRACTION_PROMPT = `You are reading an alcohol beverage label image for a TTB compliance check. Extract the following fields exactly as they appear on the label, preserving capitalization and punctuation. The image may be photographed at an angle, have glare, or poor lighting — do your best to read it anyway, and note quality issues.

Respond with ONLY a JSON object (no markdown fences, no preamble):
{
  "readable": true/false,
  "brand_name": "exact text or null",
  "class_type": "exact text or null (e.g. Kentucky Straight Bourbon Whiskey)",
  "alcohol_content": "exact text or null (e.g. 45% Alc./Vol. (90 Proof))",
  "net_contents": "exact text or null (e.g. 750 mL)",
  "government_warning": "the COMPLETE warning statement text exactly as printed, preserving capitalization, or null if absent",
  "warning_prefix_all_caps": true/false (is 'GOVERNMENT WARNING:' printed in all capital letters?),
  "warning_appears_bold": true/false (does the GOVERNMENT WARNING prefix appear bold relative to surrounding text?),
  "warning_legibility": "normal" | "small_or_hard_to_read",
  "image_quality_note": "brief note if angle/glare/blur affected reading, else null"
}`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
    return;
  }

  const { image, media_type } = req.body || {};
  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "Missing image data." });
    return;
  }
  // ~20 MB raw image ceiling (base64 inflates by ~4/3).
  if (image.length > 28 * 1024 * 1024) {
    res.status(413).json({ error: "Image is too large. Please use an image under 20 MB." });
    return;
  }
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const mediaType = allowedTypes.includes(media_type) ? media_type : "image/png";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
              { type: "text", text: EXTRACTION_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Anthropic API error", response.status, detail.slice(0, 500));
      res.status(502).json({ error: `AI service error (HTTP ${response.status}). Please try again.` });
      return;
    }

    const data = await response.json();
    const text = (data.content || []).map((c) => c.text || "").join("\n");
    let extracted;
    try {
      extracted = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      res.status(502).json({ error: "The AI returned an unexpected response. Please try this label again." });
      return;
    }

    res.status(200).json({ extracted });
  } catch (err) {
    console.error("Proxy failure", err);
    res.status(500).json({ error: "Could not reach the AI service. Please try again." });
  }
}
