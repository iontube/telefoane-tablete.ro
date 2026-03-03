export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
    }

    const authHeader = request.headers.get('Authorization');
    const expectedToken = env.AUTH_TOKEN;
    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    try {
      const { title, category, categorySlug } = await request.json();

      if (!title) {
        return Response.json({ error: 'title is required' }, { status: 400, headers: corsHeaders });
      }

      const prompt = buildPrompt(title, categorySlug);

      // Use flux-2-dev for higher quality (limited to ~2/day on free plan)
      const result = await env.AI.run('@cf/black-forest-labs/flux-2-dev', {
        prompt,
        width: 1024,
        height: 768,
        num_steps: 20,
      });

      return new Response(result, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000',
        },
      });

    } catch (error) {
      console.error('Image generation error:', error);
      return Response.json(
        { error: 'Image generation failed', details: error.message },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};

function buildPrompt(title, categorySlug) {
  const categoryPrompts = {
    telefoane: 'on a sleek dark reflective surface, dramatic studio lighting with teal and amber accents',
    tablete: 'on a minimalist dark desk setup, warm accent lighting, modern workspace',
    accesorii: 'neatly arranged on dark background, professional flat lay photography, ambient lighting',
    sfaturi: 'in a modern tech workspace, soft studio lighting, clean contemporary aesthetic',
    comparatii: 'side by side on dark reflective surface, comparison setup, professional studio lighting',
    oferte: 'on an elegant dark surface with subtle price tags, promotional style, warm lighting',
  };

  const setting = categoryPrompts[categorySlug] || categoryPrompts.telefoane;

  return `Realistic photograph of ${title} ${setting}, no text, no brand name, no writing, no words, no letters, no numbers. Photorealistic, high quality, professional product photography.`;
}
