// scripts/fetchWikiData.js
// Node 18+
// Run: node scripts/fetchWikiData.js

import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'

/* ========== CONFIG ========== */
const OUTPUT_BASE = path.resolve('data', 'wikipedia')
const OUTPUT_CATEGORIES = path.join(OUTPUT_BASE, 'categories')
const OUTPUT_FEATURED = path.join(OUTPUT_BASE, 'featured', 'article.json')
const OUTPUT_ONTHISDAY_DIR = path.join(OUTPUT_BASE, 'onthisday')

/* قائمة التصنيفات: كل عنصر {slug: 'EnglishFileName', title: 'Arabic Category Title (no "Category:")'} */
const CATEGORIES = [
  { slug: 'Science', title: 'علوم' },
  { slug: 'Technology', title: 'تكنولوجيا' },
  { slug: 'Culture', title: 'ثقافة' },
  { slug: 'History', title: 'تاريخ' },
  { slug: 'Geography', title: 'جغرافيا' },
  { slug: 'Sports', title: 'رياضة' },
  { slug: 'Medicine', title: 'طب' },
  { slug: 'Innovation', title: 'ابتكار' },
  { slug: 'MentalHealth', title: 'صحة_نفسية' },
  { slug: 'Environment', title: 'بيئة' },
  { slug: 'Nutrition', title: 'تغذية' },
  { slug: 'Tourism', title: 'سياحة' },
  { slug: 'LifeSciences', title: 'علوم_حياتية' }
]

/* MediaWiki endpoints */
const SITE_API = 'https://ar.wikipedia.org/w/api.php'
const REST_BASE = 'https://ar.wikipedia.org/api/rest_v1'

/* OPTIONS */
const OPTIONS = {
  cmLimit: 500,      // use 500 for server-side
  batchSize: 50,     // pageids per detail request
  includeWikitext: true,
  politeDelay: 250   // ms between requests
}

/* ========== Helpers ========== */
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ensureDir = async (dir) => await fs.mkdir(dir, { recursive: true })

async function mwQuery(paramsObj) {
  const params = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...paramsObj })
  const url = `${SITE_API}?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

function filePathUrl(imageTitle) {
  const fname = imageTitle.replace(/^File:/i, '')
  return `https://ar.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(fname)}`
}

/* بسيط: تحويل wikitext إلى plain text (مبدئي) */
function wikitextToPlain(wikitext) {
  if (!wikitext) return null
  let s = wikitext
  // إزالة قوالب ومراجع وتعليقات
  s = s.replace(/\{\{[^}]*\}\}/g, '')
  s = s.replace(/<ref[\s\S]*?<\/ref>/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  // روابط ويكي داخلية [[X|Y]] أو [[X]]
  s = s.replace(/\[\[([^\|\]]*\|)?([^\]]+)\]\]/g, '$2')
  // روابط خارجية [http... label]
  s = s.replace(/\[http[^\s\]]+\s?([^\]]+)?\]/g, '$1')
  // ملفات وتنسيقات بسيطة
  s = s.replace(/''+/g, '')
  s = s.replace(/==+[^=]+==+/g, '')
  s = s.replace(/<\/?[^>]+(>|$)/g, '')
  // ضغط المسافات
  s = s.replace(/\s{2,}/g, ' ')
  return s.trim()
}

/* حساب SHA256 لنص */
function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/* Smart write: يكتب الملف فقط لو المحتوى تغيّر */
async function writeJsonSmart(filePath, data) {
  const newJson = JSON.stringify(data, null, 2)
  try {
    const old = await fs.readFile(filePath, 'utf8').catch(() => null)
    if (old !== null) {
      if (sha256Hex(old) === sha256Hex(newJson)) {
        return { changed: false }
      }
    }
  } catch (e) {
    // ignore
  }
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, newJson, 'utf8')
  return { changed: true }
}

/* ========== Category fetching ========== */

/* Fetch all members of a category (list=categorymembers) */
async function fetchCategoryMembers(catTitle) {
  const members = []
  let cmcontinue = null
  do {
    const params = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${catTitle}`,
      cmlimit: OPTIONS.cmLimit
    }
    if (cmcontinue) params.cmcontinue = cmcontinue

    const data = await mwQuery(params)
    if (data && data.query && data.query.categorymembers) {
      for (const m of data.query.categorymembers) {
        members.push({ pageid: m.pageid, title: m.title })
      }
    }
    cmcontinue = data.continue?.cmcontinue || null
    await sleep(OPTIONS.politeDelay)
  } while (cmcontinue)
  return members
}

/* Fetch details for a set of pageids (in batches) */
async function fetchPagesDetails(pageids) {
  const out = {}
  for (let i = 0; i < pageids.length; i += OPTIONS.batchSize) {
    const batch = pageids.slice(i, i + OPTIONS.batchSize)
    const params = {
      action: 'query',
      pageids: batch.join('|'),
      prop: 'extracts|pageimages|images|revisions|info',
      exlimit: 'max',
      explaintext: true,
      // no exintro: we want full extract (explaintext without exintro gives whole text in some cases)
      piprop: 'thumbnail',
      pithumbsize: 800,
      inprop: 'url',
      rvprop: 'timestamp|ids',
      formatversion: 2
    }
    const data = await mwQuery(params)
    if (data && data.query && data.query.pages) {
      for (const p of data.query.pages) {
        const imgs = (p.images || []).map(img => filePathUrl(img.title))
        out[p.pageid] = {
          pageid: p.pageid,
          title: p.title,
          extract: p.extract || null,
          thumbnail: p.thumbnail?.source || null,
          images: imgs,
          lastmodified: p.revisions?.[0]?.timestamp || null,
          lastrevid: p.revisions?.[0]?.revid || null,
          fullurl: p.fullurl || `https://ar.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`
        }
      }
    }
    await sleep(OPTIONS.politeDelay)
  }
  return out
}

/* Fetch wikitext for batches (if option on) */
async function fetchWikitextMap(pageids) {
  const out = {}
  for (let i = 0; i < pageids.length; i += OPTIONS.batchSize) {
    const batch = pageids.slice(i, i + OPTIONS.batchSize)
    const params = {
      action: 'query',
      pageids: batch.join('|'),
      prop: 'revisions',
      rvprop: 'content|timestamp',
      rvslots: 'main',
      formatversion: 2
    }
    const data = await mwQuery(params)
    if (data && data.query && data.query.pages) {
      for (const p of data.query.pages) {
        const w = p.revisions?.[0]?.slots?.main?.content || null
        out[p.pageid] = { wikitext: w, rev_ts: p.revisions?.[0]?.timestamp || null }
      }
    }
    await sleep(OPTIONS.politeDelay)
  }
  return out
}

/* Featured (REST feed) */
async function fetchFeatured() {
  try {
    const today = new Date()
    const y = today.getUTCFullYear()
    const m = String(today.getUTCMonth() + 1).padStart(2, '0')
    const d = String(today.getUTCDate()).padStart(2, '0')
    const url = `${REST_BASE}/feed/featured/${y}/${m}/${d}`
    const res = await fetch(url, { headers: { Accept: 'application/json' }})
    if (!res.ok) {
      console.warn('featured fetch failed', res.status)
      return null
    }
    return await res.json()
  } catch (e) {
    console.warn('featured error', e)
    return null
  }
}

/* OnThisDay (REST) */
async function fetchOnThisDay() {
  try {
    const today = new Date()
    const m = String(today.getUTCMonth() + 1).padStart(2, '0')
    const d = String(today.getUTCDate()).padStart(2, '0')
    const url = `${REST_BASE}/feed/onthisday/events/${m}/${d}`
    const res = await fetch(url, { headers: { Accept: 'application/json' }})
    if (!res.ok) {
      console.warn('onthisday failed', res.status)
      return null
    }
    return await res.json()
  } catch (e) {
    console.warn('onthisday error', e)
    return null
  }
}

/* ========== MAIN ========== */
async function main() {
  console.log('Start fetching Wikipedia data...')
  await ensureDir(OUTPUT_CATEGORIES)
  await ensureDir(path.dirname(OUTPUT_FEATURED))
  await ensureDir(OUTPUT_ONTHISDAY_DIR)

  for (const cat of CATEGORIES) {
    try {
      console.log(`\n--- Processing category: ${cat.title} -> ${cat.slug}.json`)
      const members = await fetchCategoryMembers(cat.title)
      console.log(`  members: ${members.length}`)

      if (!members.length) {
        console.warn('  No members found, skipping.')
        continue
      }

      const pageids = members.map(m => m.pageid)
      const details = await fetchPagesDetails(pageids)

      let wmap = {}
      if (OPTIONS.includeWikitext) {
        console.log('  fetching wikitext...')
        wmap = await fetchWikitextMap(pageids)
      }

      const timestampFetched = new Date().toISOString()

      const combined = pageids.map(pid => {
        const d = details[pid] || {}
        const w = wmap[pid]?.wikitext || null
        const fullPlain = w ? wikitextToPlain(w) : null
        return {
          pageid: pid,
          title: d.title || null,
          lastModified: d.lastmodified || null,
          extract: d.extract || null,
          images: d.images || [],
          thumbnail: d.thumbnail || null,
          fullurl: d.fullurl || null,
          wikitext: w,
          fulltext_plain: fullPlain,
          timestampFetched
        }
      })

      const outFile = path.join(OUTPUT_CATEGORIES, `${cat.slug}.json`)
      const wrote = await writeJsonSmart(outFile, combined)
      console.log(`  saved: ${outFile} (changed: ${wrote.changed})`)
      await sleep(300)
    } catch (err) {
      console.error('Error processing category', cat, err)
    }
  }

  // Featured
  try {
    const featured = await fetchFeatured()
    if (featured) {
      const wroteF = await writeJsonSmart(OUTPUT_FEATURED, featured)
      console.log(`featured saved (changed: ${wroteF.changed})`)
    } else {
      console.warn('featured not updated')
    }
  } catch (e) {
    console.warn('featured error', e)
  }

  // onthisday
  try {
    const onthis = await fetchOnThisDay()
    if (onthis) {
      const today = new Date()
      const fname = `${today.getUTCFullYear()}-${String(today.getUTCMonth()+1).padStart(2,'0')}-${String(today.getUTCDate()).padStart(2,'0')}.json`
      const outPath = path.join(OUTPUT_ONTHISDAY_DIR, fname)
      const wroteO = await writeJsonSmart(outPath, onthis)
      console.log(`onthisday saved: ${outPath} (changed: ${wroteO.changed})`)
    } else {
      console.warn('onthisday not updated')
    }
  } catch (e) {
    console.warn('onthisday error', e)
  }

  console.log('\nAll done.')
}

main().catch(err => {
  console.error('Fatal error', err)
  process.exit(1)
})
