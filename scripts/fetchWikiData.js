import fs from "fs-extra";
import fetch from "node-fetch";

const OUTPUT_DIR = "./data/wikipedia";
const CATEGORIES = {
  علوم: "Science",
  ثقافة: "Culture",
  تاريخ: "History",
  جغرافيا: "Geography",
  طب: "Medicine",
  "صحة نفسية": "MentalHealth",
  تغذية: "Nutrition",
  سياحة: "Tourism",
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 🧩 جلب صورة بديلة من داخل المقال (لو مفيش صورة رئيسية)
async function fetchFallbackImage(title) {
  const url = `https://ar.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
    title
  )}&format=json&origin=*`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const images = data?.parse?.images || [];
    if (images.length > 0) {
      return `https://ar.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(
        images[0]
      )}`;
    }
  } catch (err) {
    console.error("⚠️ خطأ في جلب الصورة الداخلية:", title, err.message);
  }
  return null;
}

// 🧩 جلب أول 5 سطور من المقال (بدون نص بديل عند الفشل)
async function fetchFirstLines(title) {
  const url = `https://ar.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=true&titles=${encodeURIComponent(
    title
  )}&format=json&origin=*`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const page = Object.values(pages)[0];
    const extract = page?.extract?.trim() || "";

    if (!extract) return "";

    const lines = extract.split("\n").filter((l) => l.trim().length > 0);
    return lines.slice(0, 5).join(" ");
  } catch {
    return "";
  }
}

// 🧠 جلب المقالات للتصنيف
async function fetchCategory(categoryAr, categoryEn) {
  console.log(`\n--- Processing category: ${categoryAr} -> ${categoryEn}.json`);
  const articles = [];
  let continueToken = null;

  do {
    let url = `https://ar.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=categorymembers&gcmtitle=تصنيف:${encodeURIComponent(
      categoryAr
    )}&gcmlimit=50&prop=pageimages&piprop=thumbnail&pithumbsize=400`;

    if (continueToken) url += `&gcmcontinue=${encodeURIComponent(continueToken)}`;

    const res = await fetch(url);
    const data = await res.json();
    const pages = data?.query?.pages;
    continueToken = data?.continue?.gcmcontinue;

    if (pages) {
      for (const page of Object.values(pages)) {
        // ⛔ استبعاد الصفحات غير المفيدة
        if (!page.title || page.title.startsWith("مستخدم:")) continue;

        const description = await fetchFirstLines(page.title);
        const image =
          page.thumbnail?.source || (await fetchFallbackImage(page.title)) || null;

        // ⚙️ تجاهل المقالات الفارغة (بدون عنوان أو بدون نص)
        if (!description) continue;

        articles.push({
          title: page.title,
          description,
          image,
          url: `https://ar.wikipedia.org/wiki/${encodeURIComponent(page.title)}`
        });
      }
    }

    await delay(1000);
  } while (continueToken);

  console.log(`✅ Saved ${articles.length} articles for ${categoryAr}`);
  const filePath = `${OUTPUT_DIR}/categories/${categoryEn}.json`;
  await fs.outputJson(filePath, articles, { spaces: 2 });
}


// 🌟 المقالة المختارة لليوم (بنفس المنهج)
async function fetchFeaturedArticle() {
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = String(today.getUTCMonth() + 1).padStart(2, "0");
  const day = String(today.getUTCDate()).padStart(2, "0");
  const url = `https://ar.wikipedia.org/api/rest_v1/feed/featured/${year}/${month}/${day}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const article = data?.tfa;
    if (!article) {
      console.log("⚠️ No featured article found for today.");
      return;
    }

    const title = article.title;
    let image = article.thumbnail?.source || null;
    if (!image) image = await fetchFallbackImage(title);

    const description = await fetchFirstLines(title);
    const featured = {
      title,
      description,
      image,
      url: article.content_urls?.desktop?.page || null,
      date: `${year}-${month}-${day}`
    };

    await fs.outputJson(`${OUTPUT_DIR}/featured/article.json`, featured, { spaces: 2 });
    console.log(`🌟 Featured article saved for ${year}-${month}-${day}`);
  } catch (err) {
    console.error("⚠️ Error fetching featured article:", err);
  }
}

// 🚀 التنفيذ الكامل
(async () => {
  console.log("🚀 بدء جلب بيانات ويكيبيديا...");

  for (const [ar, en] of Object.entries(CATEGORIES)) {
    await fetchCategory(ar, en);
  }

  await fetchFeaturedArticle();
  console.log("✅ All Wikipedia data fetched successfully!");
})();


