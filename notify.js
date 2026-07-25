// روبوت إشعارات هوية بريس التلقائية
// يفحص الموقع، وإذا وجد خبراً جديداً أرسل إشعاراً (صورة + عنوان + نص)
// لكل مستخدمي التطبيق المشتركين في موضوع "news".

const admin = require("firebase-admin");
const fs = require("fs");

const STATE_FILE = "last_sent.json";
const TOPIC = "news";
const MAX_PER_RUN = 5; // حد أقصى 5 إشعارات في الدورة الواحدة حتى لا نزعج المستخدم

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

function decode(str) {
  return (str || "")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#8212;/g, "\u2014")
    .replace(/&#8220;/g, "\u201c")
    .replace(/&#8221;/g, "\u201d")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const res = await fetch("https://howiyapress.com/wp-json/wp/v2/posts?per_page=5&_embed=1");
  if (!res.ok) throw new Error("فشل الاتصال بموقع هوية بريس: " + res.status);
  const posts = await res.json();
  if (!Array.isArray(posts) || posts.length === 0) {
    console.log("لا توجد مقالات.");
    return;
  }

  let state = { lastId: 0 };
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}

  // أول تشغيل: نسجل أحدث خبر فقط بدون إرسال، حتى لا نُغرق المستخدمين بالأخبار القديمة
  if (!state.lastId) {
    state.lastId = posts[0].id;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    console.log("التشغيل الأول: تم تسجيل نقطة البداية، لم يُرسل أي إشعار.");
    return;
  }

  // الأخبار الجديدة فقط، مرتبة من الأقدم للأحدث
  const newPosts = posts.filter(p => p.id > state.lastId).reverse().slice(0, MAX_PER_RUN);
  if (newPosts.length === 0) {
    console.log("لا أخبار جديدة.");
    return;
  }

  for (const post of newPosts) {
    const title = decode(post.title?.rendered) || "خبر جديد من هوية بريس";
    let body = decode((post.excerpt?.rendered || "").replace(/<[^>]*>/g, ""));
    if (body.length > 120) body = body.substring(0, 120) + "...";

    let image = null;
    if (post._embedded?.["wp:featuredmedia"]?.[0]?.source_url) {
      image = post._embedded["wp:featuredmedia"][0].source_url;
    }

    const message = {
      topic: TOPIC,
      notification: { title, body },
      android: {
        notification: {
          sound: "default",
          ...(image ? { imageUrl: image } : {}),
        },
        priority: "high",
      },
      data: { url: post.link || "" },
    };

    await admin.messaging().send(message);
    console.log("تم إرسال إشعار:", title);
    state.lastId = Math.max(state.lastId, post.id);
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
