import keywordsData from '../../keywords.json';

const siteUrl = 'https://telefoane-tablete.ro';

function slugify(text) {
  return text.toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export async function GET() {
  const articles = keywordsData.completed
    .map(item => ({
      title: item.keyword.charAt(0).toUpperCase() + item.keyword.slice(1),
      slug: slugify(item.keyword),
      excerpt: item.excerpt || '',
      category: item.category,
      date: item.modifiedDate || item.date || new Date().toISOString(),
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const items = articles.map(a => `    <item>
      <title><![CDATA[${a.title}]]></title>
      <link>${siteUrl}/${a.slug}/</link>
      <guid isPermaLink="true">${siteUrl}/${a.slug}/</guid>
      <description><![CDATA[${a.excerpt}]]></description>
      <category>${a.category}</category>
      <pubDate>${new Date(a.date).toUTCString()}</pubDate>
    </item>`).join('\n');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Telefoane-Tablete.ro</title>
    <link>${siteUrl}</link>
    <description>Recenzii, comparatii si recomandari pentru telefoane, tablete si accesorii</description>
    <language>ro</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
