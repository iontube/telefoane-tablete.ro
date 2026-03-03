import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// 20 Gemini API Keys (rotated)
const GEMINI_KEYS = [
  'AIzaSyAbRzbs0WRJMb0gcojgyJlrjqOPr3o2Cmk',
  'AIzaSyDZ2TklBMM8TU3FA6aIS8vdUc-2iMyHWaM',
  'AIzaSyBdmChQ0ARDdDAqSMSlDIit_xz5ucrWjkY',
  'AIzaSyAE57AIwobFO4byKbeoa-tVDMV5lMgcAxQ',
  'AIzaSyBskPrKeQvxit_Rmm8PG_NO0ZhMQsrktTE',
  'AIzaSyAkUcQ3YiD9cFiwNh8pkmKVxVFxEKFJl2Q',
  'AIzaSyDnX940N-U-Sa0202-v3_TOjXf42XzoNxE',
  'AIzaSyAMl3ueRPwzT1CklxkylmTXzXkFd0A_MqI',
  'AIzaSyA82h-eIBvHWvaYLoP26zMWI_YqwT78OaI',
  'AIzaSyBRI7pd1H2EdCoBunJkteKaCDSH3vfqKUg',
  'AIzaSyA3IuLmRWyTtygsRJYyzHHvSiTPii-4Dbk',
  'AIzaSyB6RHadv3m1WWTFKb_rB9ev_r4r2fM9fNU',
  'AIzaSyCexyfNhzT2py3FLo3sXftqKh0KUdAT--A',
  'AIzaSyC_SN_RdQ2iXzgpqng5Byr-GU5KC5npiAE',
  'AIzaSyBOV9a_TmVAayjpWemkQNGtcEf_QuiXMG0',
  'AIzaSyCFOafntdykM82jJ8ILUqY2l97gdOmwiGg',
  'AIzaSyACxFhgs3tzeeI5cFzrlKmO2jW0l8poPN4',
  'AIzaSyBhZXBhPJCv9x8jKQljZCS4b5bwF3Ip3pk',
  'AIzaSyDF7_-_lXcAKF81SYpcD-NiA5At4Bi8tp8',
  'AIzaSyAwinD7oQiQnXeB2I5kyQsq_hEyJGhSrNg',
];

// Rate limiting state
const keyState = GEMINI_KEYS.map((key, i) => ({
  key,
  index: i,
  lastUsed: 0,
  cooldownUntil: 0,
  dailyCount: 0,
}));

const MIN_GAP_MS = 5000; // 5 seconds between uses of same key

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Acquire best available key with rate limiting
async function acquireKey() {
  const maxWait = 120_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const now = Date.now();
    let bestKey = null;
    let bestTime = Infinity;

    for (const k of keyState) {
      const nextAt = Math.max(k.cooldownUntil, k.lastUsed + MIN_GAP_MS);
      if (nextAt < bestTime) {
        bestTime = nextAt;
        bestKey = k;
      }
    }

    if (!bestKey) throw new Error('No keys available');

    const waitMs = Math.max(0, bestTime - now);
    if (waitMs === 0) return bestKey;

    await sleep(Math.min(waitMs + 50, 10_000));
  }

  throw new Error('Timeout waiting for available key');
}

// Call Gemini API with key rotation and retries
async function callGemini(prompt, maxRetries = 5) {
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ks = await acquireKey();
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${ks.key}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 20000,
            topP: 0.95,
            topK: 40
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Empty response');
        ks.lastUsed = Date.now();
        ks.dailyCount++;
        return text;
      }

      const errorBody = await response.text();

      if (response.status === 429) {
        // Parse retry delay
        let cooldownMs = 60_000;
        try {
          const errData = JSON.parse(errorBody);
          const retryInfo = errData?.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
          if (retryInfo?.retryDelay) {
            const sec = parseFloat(retryInfo.retryDelay);
            if (!isNaN(sec) && sec > 0) cooldownMs = sec * 1000;
          }
        } catch {}
        ks.cooldownUntil = Date.now() + cooldownMs + 2000;
        console.log(`  Key ${ks.index} rate limited, cooldown ${Math.ceil(cooldownMs/1000)}s`);
        continue;
      }

      if (response.status >= 500) {
        ks.cooldownUntil = Date.now() + 10_000;
        await sleep(2000);
        continue;
      }

      throw new Error(`API ${response.status}: ${errorBody.slice(0, 200)}`);
    } catch (error) {
      if (error.message.startsWith('API ')) throw error;
      lastError = error;
      ks.cooldownUntil = Date.now() + 5000;
      await sleep(1000);
    }
  }

  throw lastError || new Error('Max retries exhausted');
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeForHtml(str) {
  if (!str) return '';
  return str.replace(/"/g, '&quot;');
}

function stripStrong(str) {
  return str.replace(/<\/?strong>/g, '');
}

function markdownToHtml(text) {
  if (!text) return text;
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/^\*\s+/gm, '');
  text = text.replace(/^-\s+/gm, '');
  return text;
}

// Image generation via Cloudflare Workers AI REST API (flux-2-dev)
const CF_ACCOUNT_ID = '5e503b369b8f43d6722ef7e644969bcb';
const CF_API_TOKEN = 'JFNsPaoJGHzDhSO6uuvlXyiVdU0lAgcvUO_hSuTD';

async function translateToEnglish(text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ks = await acquireKey();
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${ks.key}`;
    try {
      ks.lastUsed = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Translate the following Romanian text to English. Return ONLY the English translation, nothing else:\n\n${text}` }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 200 }
        })
      });
      const data = await response.json();
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text.trim();
      }
      console.error(`  Translation attempt ${attempt + 1} failed: no candidates`);
      await sleep(2000);
    } catch (error) {
      console.error(`  Translation attempt ${attempt + 1} error: ${error.message}`);
      await sleep(2000);
    }
  }
  return text;
}

function stripBrands(text) {
  return text
    .replace(/\b[A-Z][a-z]+[A-Z]\w*/g, '')
    .replace(/\b[A-Z]{2,}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function rephraseWithoutBrands(text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ks = await acquireKey();
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${ks.key}`;
    try {
      ks.lastUsed = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Rephrase the following into a short, generic English description for an image prompt. Remove ALL brand names, trademarks, product names, and game names. Replace them with generic descriptions of what they are. Return ONLY the rephrased text, nothing else.\n\nExample: "Samsung Galaxy S25 review" -> "premium flagship smartphone with large screen"\nExample: "Best budget phones under 500" -> "affordable modern smartphones lineup"\nExample: "iPad vs Android tablets comparison" -> "two different tablets side by side"\n\nText: "${text}"` }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 100 }
        })
      });
      const data = await response.json();
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const result = data.candidates[0].content.parts[0].text.trim();
        console.log(`  Rephrased prompt (no brands): ${result}`);
        return result;
      }
    } catch (error) {
      console.error(`  Rephrase attempt ${attempt + 1} error: ${error.message}`);
    }
    if (attempt < 2) await sleep(2000);
  }
  return stripBrands(text);
}

async function generateArticleImage(keyword, category, categorySlug) {
  const slug = slugify(keyword);
  const imagesDir = path.join(rootDir, 'public', 'images', 'articles');

  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  const outputPath = path.join(imagesDir, `${slug}.webp`);

  if (fs.existsSync(outputPath)) {
    console.log(`  Image already exists: ${slug}.webp`);
    return `/images/articles/${slug}.webp`;
  }

  console.log(`  Generating image for: ${keyword}`);

  const categoryPrompts = {
    telefoane: 'on a sleek dark reflective surface, dramatic studio lighting with teal and amber accents',
    tablete: 'on a minimalist dark desk setup, warm accent lighting, modern workspace',
    accesorii: 'neatly arranged on dark background, professional flat lay photography, ambient lighting',
    sfaturi: 'in a modern tech workspace, soft studio lighting, clean contemporary aesthetic',
    comparatii: 'side by side on dark reflective surface, comparison setup, professional studio lighting',
    oferte: 'on an elegant dark surface with subtle price tags, promotional style, warm lighting',
  };

  const MAX_IMAGE_RETRIES = 3;
  let promptFlagged = false;

  for (let attempt = 1; attempt <= MAX_IMAGE_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log(`  Image retry attempt ${attempt}/${MAX_IMAGE_RETRIES}...`);
      await sleep(3000 * attempt);
    }

    try {
      const titleEn = await translateToEnglish(keyword);
      console.log(`  Translated title: ${titleEn}`);

      const setting = categoryPrompts[categorySlug] || categoryPrompts.telefoane;
      const subject = promptFlagged ? await rephraseWithoutBrands(titleEn) : titleEn;
      const prompt = `Realistic photograph of ${subject} ${setting}, no text, no brand name, no writing, no words, no letters, no numbers. Photorealistic, high quality, professional product photography.`;

      const formData = new FormData();
      formData.append('prompt', prompt);
      formData.append('steps', '20');
      formData.append('width', '1024');
      formData.append('height', '768');

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-2-dev`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
          body: formData,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`  Image API error: ${response.status} - ${errorText.slice(0, 200)}`);
        if (errorText.includes('flagged')) promptFlagged = true;
        continue;
      }

      const data = await response.json();
      if (!data.result?.image) {
        console.error('  No image in response');
        continue;
      }

      const imageBuffer = Buffer.from(data.result.image, 'base64');
      const sharp = (await import('sharp')).default;
      await sharp(imageBuffer)
        .resize(800, 600, { fit: 'cover' })
        .webp({ quality: 82, effort: 6 })
        .toFile(outputPath);

      const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(0);
      console.log(`  Image saved: ${slug}.webp (${sizeKB} KB)`);
      return `/images/articles/${slug}.webp`;

    } catch (error) {
      console.error(`  Image generation error: ${error.message}`);
      continue;
    }
  }

  console.error('  Image generation failed after all retries');
  return null;
}

// Repair common JSON issues from LLM output
function repairJSON(text) {
  // Strip markdown fences
  text = text.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '').trim();

  // Extract JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) text = jsonMatch[0];

  // Fix trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, '$1');

  // Fix unescaped newlines inside JSON string values
  // Replace actual newlines inside strings with \n
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString && ch === '\n') {
      result += '\\n';
      continue;
    }
    if (inString && ch === '\r') {
      continue;
    }
    if (inString && ch === '\t') {
      result += '\\t';
      continue;
    }
    result += ch;
  }

  return result;
}

// Generate article content using Gemini
async function generateArticleContent(keyword, category) {
  const prompt = `Scrii articole pe un site romanesc de review-uri tech. Stilul e informativ dar directionat spre conversie - ajuti cititorul sa ia o decizie de cumparare. NU esti un AI.

Keyword: "${keyword}"
Categorie: "${category}"

GENEREAZA un articol complet in format JSON. Fara diacritice. Minim 2000 cuvinte.

=== TONUL SI STILUL (CRITIC) ===
Tonul e informativ-conversional, NU personal/jurnal. Scopul e sa raspunzi la intentia de cautare si sa ghidezi spre cumparare.

INTRO:
- Primul paragraf RASPUNDE DIRECT la intentia din keyword. Daca cineva cauta "${keyword}", ce vrea sa afle? Raspunde-i imediat.
- Exemplu bun: "Cel mai bun telefon sub 1000 lei este Xiaomi Redmi Note 13, datorita ecranului AMOLED de 120Hz si bateriei de 5000 mAh la un pret de ~800 lei. Dar alegerea depinde de ce prioritizezi - camera, autonomie sau performanta."
- Exemplu prost: "Daca vrei cel mai bun telefon, stai linistit, n-ai venit sa te plimbi. Sincer, piata e un haos..."
- Nu incepe cu anecdote, nu incepe cu "tu" sau "daca vrei". Incepe cu RASPUNSUL.

REVIEW-URI PRODUSE:
- Ton obiectiv dar accesibil - ca un review pe un site de tech, nu ca o poveste personala
- Translatezi specs in beneficii practice: "5000 mAh inseamna o zi completa de utilizare"
- Compari cu alternative directe: "fata de Galaxy A15, are ecran mai bun dar camera mai slaba"
- Preturi concrete in lei
- Review-ul include pentru cine e potrivit si se incheie cu o recomandare clara, integrate natural
- NU exagera cu "am testat personal", "un prieten si-a luat" - maximum 1-2 astfel de referinte in tot articolul
- Tonul e de expert care informeaza, nu de prieten care povesteste

CONVERSIE:
- Ghideaza spre decizie: "daca prioritizezi camera, alege X; daca vrei autonomie, alege Y"
- Mentioneaza pretul si unde se gaseste ("disponibil la ~800 lei in magazinele online din Romania")
- Concluzia fiecarui review sa fie actionabila

=== ANTI-AI ===
- CUVINTE INTERZISE: "Asadar", "De asemenea", "Cu toate acestea", "Este important de mentionat", "Nu in ultimul rand", "in era actuala", "descopera", "fara indoiala", "in concluzie", "este esential", "este crucial", "o alegere excelenta", "ghid", "ghiduri", "exploreaza", "aprofundam", "remarcabil", "exceptional", "revolutionar", "inovativ", "vom detalia", "vom analiza", "vom explora", "vom prezenta", "in cele ce urmeaza", "in continuare vom", "sa aruncam o privire", "buget optimizat", "alegerea editorului", "editor's choice"
- TAG-URI INTERZISE IN PRODUSE: "Buget Optimizat", "Alegerea Editorului" - suna a cliseu. Foloseste in schimb: "Alegerea Noastra", "Pentru Buget Mic", "Best Buy 2026", "Raport Calitate-Pret", "Premium"
- Amesteca paragrafe scurte (1-2 prop) cu medii (3-4 prop)
- Critici oneste: fiecare produs minim 3-4 dezavantaje reale
- Limbaj natural dar nu excesiv informal

=== PARAGRAFE CU INTREBARI (IMPORTANT PENTRU AI SEARCH) ===
Multe paragrafe trebuie sa inceapa cu o INTREBARE directa urmata de raspuns. Asta permite AI-ului (Google AI Overview, ChatGPT, Perplexity) sa citeze textul tau.
- In intro: minim 1 paragraf care incepe cu intrebare
- In review-urile de produse: minim 1 paragraf per review care incepe cu intrebare (ex: "Cat tine bateria in utilizare reala?", "Merita camera de 108MP?", "Ce jocuri ruleaza?")
- In sectiunea de sfaturi: fiecare h4 sa fie intrebare, iar paragraful de sub el sa inceapa cu raspunsul direct
- In FAQ: intrebarile sunt deja acolo
- Exemplu bun: "Cat tine bateria de 5000 mAh in utilizare zilnica? Cu un mix de social media, browsing si YouTube, telefonul ajunge lejer la finalul zilei cu 20-30% ramas."
- Exemplu prost: "Bateria de 5000 mAh este una dintre cele mai mari din aceasta categorie de pret."

=== STRUCTURA JSON ===

IMPORTANT: Returneaza DOAR JSON valid. Fara markdown, fara backticks.
In valorile string din JSON, foloseste \\n pentru newline si escaped quotes \\".

{
  "intro": "2-3 paragrafe HTML (<p>). PRIMUL PARAGRAF raspunde direct la intentia de cautare - ce produs e cel mai bun si de ce, cu date concrete. Din el se extrage automat descrierea. Paragrafele urmatoare detaliaza criteriile si contextul.",
  "products": [
    {
      "name": "Numele complet al produsului",
      "tag": "Best Buy 2026",
      "specs": {
        "procesor": "ex: Snapdragon 8 Elite",
        "display": "ex: 6.8 inch AMOLED, 120Hz",
        "ram": "ex: 12 GB",
        "stocare": "ex: 256 GB",
        "baterie": "ex: 5000 mAh",
        "camera": "ex: 200MP + 12MP ultrawide + 10MP tele 3x"
      },
      "review": "4-6 paragrafe HTML (<p>). Review obiectiv: ce face bine, ce face prost, comparat cu ce, pentru cine, la ce pret. Ultimul paragraf = recomandare actionabila.",
      "avantaje": ["avantaj 1", "avantaj 2", "avantaj 3", "avantaj 4", "avantaj 5"],
      "dezavantaje": ["dezavantaj 1", "dezavantaj 2", "dezavantaj 3", "dezavantaj 4"]
    }
  ],
  "comparison": {
    "intro": "1 paragraf introductiv pentru tabelul comparativ",
    "rows": [
      {
        "model": "Numele modelului",
        "procesor": "CPU scurt",
        "display": "scurt",
        "baterie": "mAh",
        "camera": "MP principal",
        "potrivitPentru": "scurt, 3-5 cuvinte"
      }
    ]
  },
  "guide": {
    "title": "Titlu ca intrebare (ex: Cum alegi telefonul potrivit sub 1000 lei?)",
    "content": "3-5 paragrafe HTML (<p>, <h4>, <p>) cu sfaturi de cumparare orientate spre decizie. Sub-intrebari ca <h4>. Fiecare sfat directioneaza spre un tip de produs."
  },
  "faq": [
    {
      "question": "Intrebare naturala de cautare Google",
      "answer": "Raspuns direct 40-70 cuvinte cu cifre concrete."
    }
  ]
}

=== CERINTE PRODUSE ===
- 5-7 produse relevante pentru "${keyword}", ordonate dupa relevanta
- Specs REALE si CORECTE
- Preturi realiste in lei, Romania 2026
- Review minim 200 cuvinte per produs
- Avantaje: 4-6 | Dezavantaje: 3-5 (oneste, nu cosmetice)
- Tag-uri: "Best Buy 2026", "Raport Calitate-Pret", "Premium", "Pentru Buget Mic", "Alegerea Noastra"
- INTERZIS in tag-uri: "Alegerea Editorului", "Buget Optimizat", "Editor's Choice" - suna a cliseu AI

=== CERINTE SECTIUNE SFATURI ===
- Titlul sectiunii sa fie o intrebare: "Cum alegi...?", "Ce conteaza cand...?"
- Sub-intrebari practice ca h4
- Fiecare sfat directioneaza: "daca X, atunci alege Y"
- NU folosi cuvantul "ghid" nicaieri

=== CERINTE FAQ ===
- 5 intrebari formulari naturale: "cat costa...", "care e diferenta intre...", "merita sa..."
- Raspunsuri cu cifre concrete, auto-suficiente, fara diacritice

=== REGULI ===
- FARA diacritice (fara ă, î, ș, ț, â)
- Preturile in LEI, realiste
- Keyword "${keyword}" in <strong> de 4-6 ori in articol
- NICIODATA <strong> in titluri/headings
- Total minim 2000 cuvinte`;

  let retries = 7;
  while (retries > 0) {
    try {
      let text = await callGemini(prompt);

      // Repair JSON
      text = repairJSON(text);

      try {
        const parsed = JSON.parse(text);
        if (parsed.intro && parsed.products && parsed.products.length > 0 && parsed.faq) {
          return parsed;
        }
        console.error('  Invalid JSON structure (missing fields), retrying...');
      } catch (parseError) {
        // Log position context for debugging
        const pos = parseError.message.match(/position (\d+)/);
        if (pos) {
          const p = parseInt(pos[1]);
          console.error(`  JSON parse error at pos ${p}: ...${text.substring(Math.max(0, p-30), p)}>>>HERE>>>${text.substring(p, p+30)}...`);
        } else {
          console.error(`  JSON parse error: ${parseError.message.substring(0, 100)}`);
        }
      }

      retries--;
      await sleep(2000);
    } catch (error) {
      console.error(`  API/Generation error: ${error.message?.substring(0, 100)}, retrying...`);
      retries--;
      await sleep(2000);
    }
  }

  throw new Error('Failed to generate content after retries');
}

// Create article .astro page
function createArticlePage(keyword, content, category, categorySlug, author, pubDate) {
  const slug = slugify(keyword);
  const title = capitalizeFirst(keyword);
  const date = pubDate || new Date().toISOString();
  const modified = new Date().toISOString();

  // Clean HTML content
  function cleanHtml(text) {
    if (!text) return '';
    text = markdownToHtml(text);
    if (!text.includes('<p>') && !text.includes('<h')) {
      text = text.split(/\n\n+/).filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('\n');
    }
    return text;
  }

  // Process intro and extract excerpt from first paragraph
  const introHtml = cleanHtml(content.intro || '');
  const firstPMatch = introHtml.match(/<p>([\s\S]*?)<\/p>/);
  let excerpt = firstPMatch ? firstPMatch[1].replace(/<[^>]*>/g, '').replace(/\*\*/g, '') : '';
  // Trim to ~2 sentences if too long
  if (excerpt.length > 300) {
    const sentences = excerpt.match(/[^.!?]+[.!?]+/g) || [excerpt];
    excerpt = sentences.slice(0, 2).join('').trim();
  }

  // Generate product review HTML blocks
  const productReviewsHtml = (content.products || []).map((product, idx) => {
    const productId = slugify(product.name);
    const specs = product.specs || {};
    const specsGrid = Object.entries(specs).map(([key, val]) =>
      `              <div class="product-review__spec">
                <strong>${capitalizeFirst(key)}</strong>${val}
              </div>`
    ).join('\n');

    const reviewContent = cleanHtml(product.review || '');

    const avantajeHtml = (product.avantaje || []).map(a =>
      `              <li>${markdownToHtml(a)}</li>`
    ).join('\n');

    const dezavantajeHtml = (product.dezavantaje || []).map(d =>
      `              <li>${markdownToHtml(d)}</li>`
    ).join('\n');

    const tag = product.tag || '';

    return `
          <article class="product-review" id="${productId}">
            <div class="product-review__header">
              ${tag ? `<span class="section-tag">${tag}</span>` : ''}
              <h3>${product.name}</h3>
              <div class="product-review__specs-grid">
${specsGrid}
              </div>
            </div>
            <div class="product-review__content">
              ${reviewContent}

              <div class="product-review__lists">
                <div>
                  <h4>Avantaje</h4>
                  <ul class="product-review__pros">
${avantajeHtml}
                  </ul>
                </div>
                <div>
                  <h4>Dezavantaje</h4>
                  <ul class="product-review__cons">
${dezavantajeHtml}
                  </ul>
                </div>
              </div>
            </div>
          </article>`;
  }).join('\n');

  // Generate comparison table HTML
  let comparisonHtml = '';
  if (content.comparison && content.comparison.rows && content.comparison.rows.length > 0) {
    const compIntro = cleanHtml(content.comparison.intro || '');
    const compRows = content.comparison.rows.map(row => `
              <tr>
                <td><strong>${row.model}</strong></td>
                <td>${row.procesor || ''}</td>
                <td>${row.display || ''}</td>
                <td>${row.baterie || ''}</td>
                <td>${row.camera || ''}</td>
                <td>${row.potrivitPentru || ''}</td>
              </tr>`).join('\n');

    comparisonHtml = `
          <section id="comparatie">
            <h2>Comparatie</h2>
            ${compIntro}
            <div class="comparison-outer">
              <div class="comparison-hint">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                Gliseaza pentru a vedea tot tabelul
              </div>
              <div class="comparison-wrap">
                <table class="comparison-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Procesor</th>
                      <th>Display</th>
                      <th>Baterie</th>
                      <th>Camera</th>
                      <th>Potrivit pentru</th>
                    </tr>
                  </thead>
                  <tbody>
${compRows}
                  </tbody>
                </table>
              </div>
            </div>
          </section>`;
  }

  // Generate guide HTML
  let guideHtml = '';
  if (content.guide) {
    const guideTitle = content.guide.title || 'Sfaturi de cumparare';
    const guideContent = cleanHtml(content.guide.content || '');
    guideHtml = `
          <section id="sfaturi">
            <h2>${stripStrong(guideTitle)}</h2>
            <div class="guide">
              ${guideContent}
            </div>
          </section>`;
  }

  // Generate FAQ HTML
  const faqHtml = (content.faq || []).map((item, index) => `
            <details class="faq-item" id="faq-${index}">
              <summary>
                ${stripStrong(markdownToHtml(item.question))}
                <span class="faq-icon">+</span>
              </summary>
              <div class="faq-answer">
                ${stripStrong(markdownToHtml(item.answer))}
              </div>
            </details>`).join('\n');

  const faqArray = (content.faq || []).map(item =>
    `{ question: "${stripStrong(item.question).replace(/"/g, '\\"')}", answer: "${stripStrong(item.answer).replace(/"/g, '\\"').replace(/\n/g, ' ')}" }`
  );

  // Build TOC from products + comparison + guide + FAQ
  const tocEntries = [];
  (content.products || []).forEach(p => {
    tocEntries.push({ title: p.name, id: slugify(p.name) });
  });
  if (comparisonHtml) tocEntries.push({ title: 'Comparatie', id: 'comparatie' });
  if (guideHtml) tocEntries.push({ title: content.guide?.title || 'Sfaturi de cumparare', id: 'sfaturi' });
  tocEntries.push({ title: 'Intrebari Frecvente', id: 'faq' });

  const tocItems = tocEntries.map(t =>
    `{ title: "${t.title.replace(/"/g, '\\"')}", id: "${t.id}" }`
  );

  const pubDateDisplay = new Date(date).toLocaleDateString('ro-RO', { year: 'numeric', month: 'long', day: 'numeric' });
  const modifiedDateDisplay = new Date(modified).toLocaleDateString('ro-RO', { year: 'numeric', month: 'long', day: 'numeric' });

  const pageContent = `---
import Layout from '../layouts/Layout.astro';
import SimilarArticles from '../components/SimilarArticles.astro';
import keywordsData from '../../keywords.json';

export const frontmatter = {
  title: "${title}",
  excerpt: "${excerpt.replace(/"/g, '\\"')}",
  image: "/images/articles/${slug}.webp",
  category: "${category}",
  categorySlug: "${categorySlug}",
  date: "${date}",
  modifiedDate: "${modified}",
  author: "${author.name}",
  authorRole: "${author.role}",
  authorBio: "${author.bio.replace(/"/g, '\\"')}"
};

const breadcrumbs = [
  { name: "Acasa", url: "/" },
  { name: "${category}", url: "/${categorySlug}/" },
  { name: "${title}", url: "/${slug}/" }
];

const faq = [
  ${faqArray.join(',\n  ')}
];

const toc = [
  ${tocItems.join(',\n  ')}
];

const allArticles = keywordsData.completed.map(item => ({
  title: item.keyword.charAt(0).toUpperCase() + item.keyword.slice(1),
  slug: item.keyword.toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
  excerpt: item.excerpt || '',
  image: \`/images/articles/\${item.keyword.toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, '')}.webp\`,
  category: item.category,
  categorySlug: item.categorySlug,
  date: item.date || new Date().toISOString()
}));
---

<Layout
  title="${escapeForHtml(title)} - Telefoane-Tablete.ro"
  description="${escapeForHtml(excerpt)}"
  image="/images/articles/${slug}.webp"
  type="article"
  publishedTime="${date}"
  modifiedTime="${modified}"
  author="${escapeForHtml(author.name)}"
  faq={faq}
  breadcrumbs={breadcrumbs}
>
  <article class="article-page">
    <nav class="breadcrumbs" aria-label="Breadcrumbs">
      <ol>
        <li><a href="/">Acasa</a></li>
        <li><a href="/${categorySlug}/">${category}</a></li>
        <li><span>${title}</span></li>
      </ol>
    </nav>

    <a href="/${categorySlug}/" class="article-page-category">${category}</a>
    <h1 class="article-page-title">${title}</h1>

    <div class="article-page-meta">
      <span>${author.name}</span>
      <span>&middot;</span>
      <span>Publicat: ${pubDateDisplay}</span>
      <span>&middot;</span>
      <span>Actualizat: ${modifiedDateDisplay}</span>
    </div>

    <div class="article-hero">
      <img src="/images/articles/${slug}.webp" alt="${title}" width="800" height="600" decoding="async" fetchpriority="high" />
    </div>

    <div class="article-layout">
      <div>
        <div class="toc-mobile" id="toc-mobile">
          <button class="toc-mobile-toggle" id="toc-mobile-toggle" aria-expanded="false" aria-controls="toc-mobile-list">
            Cuprins
            <span class="toc-chevron">&#9660;</span>
          </button>
          <ol class="toc-mobile-list" id="toc-mobile-list">
            {toc.map(item => (
              <li><a href={\`#\${item.id}\`}>{item.title}</a></li>
            ))}
          </ol>
        </div>

        <div class="article-content">
          <section id="intro">
            ${introHtml}
          </section>

${productReviewsHtml}

${comparisonHtml}

${guideHtml}

          <section class="faq-section" id="faq">
            <h2 class="faq-title">Intrebari Frecvente</h2>
${faqHtml}
          </section>
        </div>

        <div class="author-line">
          <div class="author-avatar">${author.name.split(' ').map(n => n[0]).join('')}</div>
          <div>
            <div class="author-name">${author.name}</div>
            <div class="author-role">${author.role}</div>
          </div>
        </div>

        <SimilarArticles
          currentSlug="${slug}"
          currentCategory="${categorySlug}"
          articles={allArticles}
        />
      </div>

      <aside class="toc-sidebar">
        <p class="toc-sidebar-title">Cuprins</p>
        <ol class="toc-sidebar-list" id="toc-desktop-list">
          {toc.map(item => (
            <li><a href={\`#\${item.id}\`} data-toc-id={item.id}>{item.title}</a></li>
          ))}
        </ol>
      </aside>
    </div>
  </article>

  <script>
    // Mobile TOC toggle
    const tocToggle = document.getElementById('toc-mobile-toggle');
    const tocMobile = document.getElementById('toc-mobile');
    tocToggle?.addEventListener('click', () => {
      const isOpen = tocMobile?.classList.toggle('open');
      tocToggle.setAttribute('aria-expanded', String(!!isOpen));
    });

    // IO for active section tracking
    const tocLinks = document.querySelectorAll('#toc-desktop-list a[data-toc-id]');
    if (tocLinks.length > 0) {
      const ids = Array.from(tocLinks).map(a => a.dataset.tocId);
      const sections = ids.map(id => document.getElementById(id)).filter(Boolean);
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              tocLinks.forEach(a => a.classList.remove('active'));
              const match = Array.from(tocLinks).find(a => a.dataset.tocId === entry.target.id);
              match?.classList.add('active');
            }
          }
        },
        { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
      );
      sections.forEach(s => observer.observe(s));
    }

    // Comparison table scroll fade
    document.querySelectorAll('.comparison-outer').forEach(outer => {
      const wrap = outer.querySelector('.comparison-wrap');
      if (!wrap) return;
      function checkScroll() {
        const canScroll = wrap.scrollWidth > wrap.clientWidth;
        const atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 2;
        outer.classList.toggle('can-scroll', canScroll && !atEnd);
      }
      checkScroll();
      wrap.addEventListener('scroll', checkScroll, { passive: true });
      window.addEventListener('resize', checkScroll, { passive: true });
    });
  </script>
</Layout>
`;

  const outputPath = path.join(rootDir, 'src', 'pages', `${slug}.astro`);
  fs.writeFileSync(outputPath, pageContent);
  console.log(`  Article page created: ${outputPath}`);

  return {
    slug,
    title,
    excerpt,
    date,
    modifiedDate: modified
  };
}

// Main execution
async function main() {
  console.log('\n========================================');
  console.log('Telefoane-Tablete.ro - Article Generator');
  console.log('========================================\n');

  const keywordsPath = path.join(rootDir, 'keywords.json');
  const keywordsData = JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));

  const pending = keywordsData.pending;

  if (pending.length === 0) {
    console.log('No pending keywords to process.');
    return;
  }

  // Parse --limit flag
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 1;

  const toProcess = pending.slice(0, limit);
  console.log(`Processing ${toProcess.length} article(s)...\n`);

  const successfulKeywords = [];

  for (const item of toProcess) {
    console.log(`\nProcessing: ${item.keyword}`);
    console.log(`Category: ${item.category}`);

    try {
      // Find author for this category
      const author = keywordsData.authors.find(a => a.categories.includes(item.categorySlug))
        || keywordsData.authors[0];

      // Generate content
      console.log('  Generating content...');
      const content = await generateArticleContent(item.keyword, item.category);
      console.log('  Content generated successfully');

      // Create article page
      const articleData = createArticlePage(
        item.keyword,
        content,
        item.category,
        item.categorySlug,
        author,
        item.pubDate
      );

      // Generate hero image
      console.log('  Generating image...');
      await generateArticleImage(item.keyword, item.category, item.categorySlug);

      // Add to successful
      successfulKeywords.push({
        ...item,
        excerpt: articleData.excerpt,
        date: articleData.date,
        modifiedDate: articleData.modifiedDate
      });

      console.log(`  Completed: ${item.keyword}`);
      await sleep(1000);

    } catch (error) {
      console.error(`  Failed: ${item.keyword} - ${error.message}`);
    }
  }

  // Update keywords.json
  if (successfulKeywords.length > 0) {
    const successfulSet = new Set(successfulKeywords.map(k => k.keyword));
    keywordsData.pending = keywordsData.pending.filter(k => !successfulSet.has(k.keyword));
    keywordsData.completed = [...keywordsData.completed, ...successfulKeywords];

    fs.writeFileSync(keywordsPath, JSON.stringify(keywordsData, null, 2));
    console.log(`\nUpdated keywords.json: ${successfulKeywords.length} articles completed`);
  }

  console.log('\n========================================');
  console.log(`Total processed: ${successfulKeywords.length}/${toProcess.length}`);
  console.log('========================================\n');
}

main().catch(console.error);
