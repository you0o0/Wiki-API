import fs from "fs-extra";
import fetch from "node-fetch";

const OUTPUT_DIR = "./data/wikipedia";
const CATEGORIES = {
  علوم: "Science",
  تكنولوجيا: "Technology",
  ثقافة: "Culture",
  تاريخ: "History",
  جغرافيا: "Geography",
  رياضة: "Sports",
  طب: "Medicine",
  "صحة نفسية": "MentalHealth",
  بيئة: "Environment",
  تغذية: "Nutrition",
  سياحة: "Tourism",
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 🧩 دالة مساعدة لجلب صورة بديلة من المقالة
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

// 🧠 جلب المقالات للتصنيف
async function fetchCategory(categoryAr, categoryEn) {
  console.log(`\n--- Processing category: ${categoryAr} -> ${categoryEn}.json`);
  const articles = [];
  let continueToken = null;

  do {
    let url = `https://ar.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=categorymembers&gcmtitle=تصنيف:${encodeURIComponent(
      categoryAr
    )}&gcmlimit=50&prop=extracts|pageimages&exintro=true&explaintext=true&piprop=thumbnail&pithumbsize=400`;

    if (continueToken) url += `&gcmcontinue=${encodeURIComponent(continueToken)}`;

    const res = await fetch(url);
    const data = await res.json();
    const pages = data?.query?.pages;
    continueToken = data?.continue?.gcmcontinue;

    if (pages) {
      for (const page of Object.values(pages)) {
        if (page.title.startsWith("مستخدم:")) continue; // تجاهل صفحات المستخدمين

        let description =
          page.extract?.split("\n").slice(0, 4).join(" ") || "لا يوجد وصف متاح.";
        const image =
          page.thumbnail?.source || (await fetchFallbackImage(page.title));

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

// 🧭 المقالة المختارة لليوم (تلقائي)
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

    if (article) {
      const featured = {
        title: article.title,
        description: article.extract,
        image: article.thumbnail?.source || null,
        url: article.content_urls?.desktop?.page || null,
        date: `${year}-${month}-${day}`
      };
      await fs.outputJson(`${OUTPUT_DIR}/featured/article.json`, featured, {
        spaces: 2
      });
      console.log(`🌟 Featured article saved for ${year}-${month}-${day}`);
    } else {
      console.log("⚠️ No featured article found for today.");
    }
  } catch (err) {
    console.error("⚠️ Error fetching featured article:", err);
  }
}


// 🚀 التنفيذ
(async () => {
  console.log("Start fetching Wikipedia data...");

  for (const [ar, en] of Object.entries(CATEGORIES)) {
    await fetchCategory(ar, en);
  }

  await fetchFeaturedArticle();
  console.log("✅ All done!");
})();

