import {
  db,
  usersTable,
  userProfilesTable,
  categoriesTable,
  locationsTable,
  articlesTable,
  writerApplicationsTable,
  locationResourcesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./lib/logger";

const ADMIN_ID = process.env.SEED_ADMIN_ID || "seed-admin";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@thehit.in";

const COVERS = [
  "/seed/panchayat.png",
  "/seed/festival.png",
  "/seed/paddy.png",
  "/seed/forest.png",
  "/seed/school.png",
  "/seed/water.png",
];

const ARTICLES: Array<{
  title: string;
  summary: string;
  body: string;
  lang: "hi" | "en";
  category: string;
  location: string;
  isBreaking?: boolean;
  isFeatured?: boolean;
  cover: number;
}> = [
  {
    title: "जशपुर में आदिवासी पंचायत महासम्मेलन: हजारों ग्रामीणों की भागीदारी",
    summary:
      "जशपुर जिले के बगीचा ब्लॉक में आयोजित आदिवासी पंचायत महासम्मेलन में पारंपरिक स्वशासन, वन अधिकार और शिक्षा पर चर्चा।",
    body: "जशपुर — रविवार को बगीचा ब्लॉक के सरना मैदान में आयोजित आदिवासी पंचायत महासम्मेलन में लगभग पाँच हजार ग्रामीणों ने भाग लिया। सम्मेलन का मुख्य उद्देश्य पारंपरिक स्वशासन व्यवस्था को मजबूत करना तथा पेसा कानून के क्रियान्वयन पर चर्चा करना था। मुख्य वक्ताओं ने वन अधिकार अधिनियम, मातृभाषा में प्राथमिक शिक्षा और स्थानीय रोजगार के मुद्दों को रखा। ग्राम सभाओं की भूमिका, गोंडी और कुरूख भाषाओं में दस्तावेज़ीकरण, तथा पारंपरिक न्याय व्यवस्था पर भी विस्तार से बातचीत हुई। सम्मेलन के अंत में आगामी छह माह की कार्ययोजना भी प्रस्तुत की गई जिसमें ब्लॉक स्तर पर मासिक बैठकें तथा युवाओं के लिए नेतृत्व प्रशिक्षण शामिल है।",
    lang: "hi",
    category: "politics",
    location: "bagicha",
    isFeatured: true,
    isBreaking: true,
    cover: 0,
  },
  {
    title: "बस्तर की धरोहर: करमा महोत्सव में जीवंत हुई आदिवासी संस्कृति",
    summary:
      "जगदलपुर में तीन दिवसीय करमा महोत्सव में बस्तर के दर्जनों आदिवासी समुदायों ने अपनी पारंपरिक नृत्य और संगीत प्रस्तुति दी।",
    body: "जगदलपुर — बस्तर का सालाना करमा महोत्सव इस बार ऐतिहासिक रहा। तीन दिनों तक चले इस महोत्सव में मुरिया, माड़िया, हल्बा, धुरवा सहित कई आदिवासी समुदायों ने अपनी पारंपरिक नृत्य, गीत और वाद्ययंत्र प्रस्तुत किए। महोत्सव में पारंपरिक हस्तशिल्प, धातु ढलाई, बेल मेटल और तेरकोटा के स्टॉल भी लगे। संस्कृति विभाग के अनुसार लगभग सत्तर हजार लोगों ने महोत्सव में हिस्सा लिया, जिसमें देश-विदेश के पर्यटक भी शामिल थे। स्थानीय कलाकारों ने मांग रखी कि करमा महोत्सव को राज्य के सांस्कृतिक कैलेंडर का स्थायी हिस्सा बनाया जाए।",
    lang: "hi",
    category: "culture",
    location: "jagdalpur",
    isFeatured: true,
    cover: 1,
  },
  {
    title: "धमतरी: धान खरीदी केंद्र पर किसानों की लंबी कतार, तौल में देरी की शिकायत",
    summary:
      "धमतरी जिले के नगरी ब्लॉक के धान खरीदी केंद्रों पर किसान सुबह से शाम तक इंतज़ार कर रहे हैं। प्रशासन ने अतिरिक्त तौलकांटे लगाने की बात कही।",
    body: "धमतरी — समर्थन मूल्य पर धान खरीदी शुरू होते ही नगरी ब्लॉक के खरीदी केंद्रों पर किसानों की लंबी कतारें देखी जा रही हैं। किसानों का आरोप है कि बारदाने की कमी और टोकन वितरण की अनियमितता के कारण उन्हें कई दिनों तक इंतज़ार करना पड़ रहा है। कुछ किसानों ने बताया कि वे चार-पाँच दिन से धान लेकर खरीदी केंद्र पर डेरा डाले हैं। अनुविभागीय अधिकारी ने आश्वासन दिया है कि इस सप्ताह दो अतिरिक्त तौलकांटे लगाए जाएंगे और टोकन ऑनलाइन उपलब्ध कराए जाएंगे। किसान संगठनों ने मांग की है कि छोटे और सीमांत किसानों को प्राथमिकता दी जाए।",
    lang: "hi",
    category: "agriculture",
    location: "nagri",
    isFeatured: true,
    cover: 2,
  },
  {
    title: "Forest Rights Act: 2,400 families in Kanker district get long-pending land titles",
    summary:
      "After years of paperwork and verification, 2,400 tribal families across Charama and Antagarh blocks received individual forest land titles this week.",
    body: "Kanker — In a significant step toward recognising historical claims of forest-dwelling communities, 2,400 tribal families in Charama and Antagarh blocks of Kanker district were handed individual forest land titles under the Forest Rights Act this week. Many of the recipients had been cultivating these plots for decades without legal ownership. The district administration said another 3,100 claims are under verification. Community forest rights — which give entire villages collective rights over forest produce — are being processed separately and are expected to be finalised in the next two quarters. Activists welcomed the move but flagged that several villages in the southern part of the district are still awaiting recognition.",
    lang: "en",
    category: "society",
    location: "kanker",
    cover: 3,
  },
  {
    title: "रायपुर: स्कूल चलें हम अभियान के तहत आदिवासी बस्तियों में दाखिले बढ़े",
    summary:
      "शिक्षा विभाग के अनुसार इस वर्ष आदिवासी बस्तियों में पहली कक्षा में दाखिले पिछले वर्ष की तुलना में 18 प्रतिशत अधिक हुए हैं।",
    body: "रायपुर — शिक्षा विभाग द्वारा जारी आँकड़ों के अनुसार छत्तीसगढ़ की आदिवासी बस्तियों में पहली कक्षा में दाखिले इस सत्र में अठारह प्रतिशत बढ़े हैं। विभाग का कहना है कि स्कूल चलें हम अभियान, मोहल्ला कक्षा और मातृभाषा में पुस्तकें उपलब्ध कराने जैसी पहलों का सकारात्मक असर दिखा है। बस्तर, सरगुजा और कोरबा संभागों में सबसे अधिक वृद्धि दर्ज की गई है। हालांकि लड़कियों के बीच ड्रॉपआउट दर अभी भी चिंताजनक है — कक्षा आठ से दस के बीच लगभग चौदह प्रतिशत बच्चियाँ पढ़ाई छोड़ देती हैं। विभाग ने कहा कि अगले चरण में मासिक कन्या छात्रवृत्ति और परिवहन सुविधा पर ज़ोर दिया जाएगा।",
    lang: "hi",
    category: "society",
    location: "raipur-state",
    cover: 4,
  },
  {
    title: "कोरबा: गाँव-गाँव पहुँचा जल जीवन मिशन, अब घर बैठे पानी",
    summary:
      "कोरबा जिले के पाली ब्लॉक के 47 गाँवों में नल कनेक्शन का काम पूरा हुआ। महिलाओं ने राहत जताई।",
    body: "कोरबा — जल जीवन मिशन के तहत कोरबा जिले के पाली ब्लॉक के सैंतालीस गाँवों में हर घर तक नल का कनेक्शन पहुँच गया है। पहले महिलाओं को रोज़ाना दो-तीन किलोमीटर दूर से पानी लाना पड़ता था। अब हर घर में सुबह-शाम पानी की आपूर्ति हो रही है। योजना के नोडल अधिकारी ने बताया कि अगले छह माह में जिले के एक सौ बीस और गाँवों में काम पूरा कर लिया जाएगा। ग्रामीणों ने मांग की है कि पाइपलाइन और टंकियों का नियमित रख-रखाव सुनिश्चित किया जाए, ताकि भविष्य में पानी की आपूर्ति बाधित न हो।",
    lang: "hi",
    category: "society",
    location: "pali",
    cover: 5,
  },
  {
    title: "सरगुजा वन विभाग: हाथी मानव संघर्ष कम करने नए कॉरिडोर की पहचान",
    summary:
      "अंबिकापुर में आयोजित बैठक में वन विभाग ने तीन नए हाथी कॉरिडोर चिह्नित किए। ग्रामीणों को मुआवज़ा प्रक्रिया भी सरल होगी।",
    body: "अंबिकापुर — सरगुजा वन वृत्त के अधिकारियों ने हाथी-मानव संघर्ष को कम करने के लिए तीन नए कॉरिडोर चिह्नित किए हैं। ये कॉरिडोर झारखंड की सीमा से लगे क्षेत्रों से होकर गुजरते हैं। विभाग ने बताया कि अब प्रत्येक प्रभावित गाँव में एक स्थानीय निगरानी समिति बनाई जाएगी, जिसमें ग्राम सभा के तीन सदस्य शामिल होंगे। फसल और जान-माल के नुकसान पर मुआवज़ा प्रक्रिया को भी सरल किया गया है — अब आवेदन सीधे ग्राम सचिवालय से ऑनलाइन भेजे जा सकेंगे।",
    lang: "hi",
    category: "society",
    location: "ambikapur",
    isBreaking: true,
    cover: 3,
  },
  {
    title: "बीजापुर: युवा आदिवासी फुटबॉल टीम ने राज्य स्तर पर जीता रजत पदक",
    summary:
      "बीजापुर ब्लॉक के बारह युवाओं की टीम ने रायपुर में आयोजित राज्य फुटबॉल चैंपियनशिप में दूसरा स्थान प्राप्त किया।",
    body: "बीजापुर — बीजापुर ब्लॉक के बारह आदिवासी युवाओं की टीम ने रायपुर में हुई राज्य स्तरीय फुटबॉल चैंपियनशिप में रजत पदक जीतकर इतिहास रचा है। यह टीम बीते डेढ़ साल से स्थानीय कोच की देखरेख में बिना मैदान, बिना उपकरण के अभ्यास कर रही थी। अब ज़िला प्रशासन ने टीम के लिए स्थायी अभ्यास मैदान, उपकरण और मासिक छात्रवृत्ति की घोषणा की है। टीम के कप्तान ने कहा कि उनका सपना अब राष््ट्रीय स्तर पर खेलने का है।",
    lang: "hi",
    category: "sports",
    location: "bijapur",
    cover: 1,
  },
];

const CATEGORIES = [
  { slug: "politics", nameHi: "राजनीति", nameEn: "Politics", sortOrder: 1 },
  { slug: "top-news", nameHi: "टॉप न्यूज़", nameEn: "Top News", sortOrder: 2 },
  { slug: "society", nameHi: "समाज", nameEn: "Society", sortOrder: 3 },
  { slug: "agriculture", nameHi: "कृषि", nameEn: "Agriculture", sortOrder: 4 },
  { slug: "rajya-shahar", nameHi: "राज्य - शहर", nameEn: "State - City", sortOrder: 5 },
  { slug: "entertainment", nameHi: "एंटरटेनमेंट", nameEn: "Entertainment", sortOrder: 6 },
  { slug: "culture", nameHi: "संस्कृति", nameEn: "Culture", sortOrder: 7 },
  { slug: "bollywood", nameHi: "बॉलीवुड", nameEn: "Bollywood", sortOrder: 8 },
  { slug: "sports", nameHi: "खेल", nameEn: "Sports", sortOrder: 9 },
  { slug: "education", nameHi: "शिक्षा", nameEn: "Education", sortOrder: 10 },
  { slug: "sports-hi", nameHi: "स्पोर्ट्स", nameEn: "Sports (Hindi)", sortOrder: 11 },
  { slug: "international", nameHi: "इंटरनेशनल", nameEn: "International", sortOrder: 12 },
  { slug: "recipe", nameHi: "रेसिपी", nameEn: "Recipe", sortOrder: 13 },
  { slug: "solah-duni", nameHi: "सोलह दूनी आठ", nameEn: "Solah Duni", sortOrder: 14 },
];

const LOCATIONS: Array<{
  slug: string;
  type: "state" | "district" | "assembly" | "block" | "village";
  nameHi: string;
  nameEn: string;
  parent?: string;
}> = [
  { slug: "raipur-state", type: "state", nameHi: "छत्तीसगढ़", nameEn: "Chhattisgarh" },

  { slug: "jashpur", type: "district", nameHi: "जशपुर", nameEn: "Jashpur", parent: "raipur-state" },
  { slug: "bastar", type: "district", nameHi: "बस्तर", nameEn: "Bastar", parent: "raipur-state" },
  { slug: "dhamtari", type: "district", nameHi: "धमतरी", nameEn: "Dhamtari", parent: "raipur-state" },
  { slug: "kanker", type: "district", nameHi: "कांकेर", nameEn: "Kanker", parent: "raipur-state" },
  { slug: "korba", type: "district", nameHi: "कोरबा", nameEn: "Korba", parent: "raipur-state" },
  { slug: "surguja", type: "district", nameHi: "सरगुजा", nameEn: "Surguja", parent: "raipur-state" },
  { slug: "bijapur-district", type: "district", nameHi: "बीजापुर", nameEn: "Bijapur", parent: "raipur-state" },

  { slug: "bagicha-assembly", type: "assembly", nameHi: "बगीचा विधानसभा", nameEn: "Bagicha Assembly", parent: "jashpur" },
  { slug: "jagdalpur-assembly", type: "assembly", nameHi: "जगदलपुर विधानसभा", nameEn: "Jagdalpur Assembly", parent: "bastar" },
  { slug: "nagri-assembly", type: "assembly", nameHi: "नगरी विधानसभा", nameEn: "Nagri Assembly", parent: "dhamtari" },
  { slug: "charama-assembly", type: "assembly", nameHi: "चारामा विधानसभा", nameEn: "Charama Assembly", parent: "kanker" },
  { slug: "pali-assembly", type: "assembly", nameHi: "पाली-तानाखार", nameEn: "Pali-Tanakhar", parent: "korba" },
  { slug: "ambikapur-assembly", type: "assembly", nameHi: "अंबिकापुर विधानसभा", nameEn: "Ambikapur Assembly", parent: "surguja" },
  { slug: "bijapur-assembly", type: "assembly", nameHi: "बीजापुर विधानसभा", nameEn: "Bijapur Assembly", parent: "bijapur-district" },

  { slug: "bagicha", type: "block", nameHi: "बगीचा ब्लॉक", nameEn: "Bagicha Block", parent: "bagicha-assembly" },
  { slug: "jagdalpur", type: "block", nameHi: "जगदलपुर ब्लॉक", nameEn: "Jagdalpur Block", parent: "jagdalpur-assembly" },
  { slug: "nagri", type: "block", nameHi: "नगरी ब्लॉक", nameEn: "Nagri Block", parent: "nagri-assembly" },
  { slug: "kanker", type: "block", nameHi: "कांकेर ब्लॉक", nameEn: "Kanker Block", parent: "charama-assembly" },
  { slug: "pali", type: "block", nameHi: "पाली ब्लॉक", nameEn: "Pali Block", parent: "pali-assembly" },
  { slug: "ambikapur", type: "block", nameHi: "अंबिकापुर ब्लॉक", nameEn: "Ambikapur Block", parent: "ambikapur-assembly" },
  { slug: "bijapur", type: "block", nameHi: "बीजापुर ब्लॉक", nameEn: "Bijapur Block", parent: "bijapur-assembly" },
];

function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "article"}-${suffix}`;
}

async function main() {
  logger.info("Seeding TheHit database...");

  // Admin user + writer
  const adminEmail = ADMIN_EMAIL;
  const [admin] = await db
    .insert(usersTable)
    .values({
      id: ADMIN_ID,
      email: adminEmail,
      firstName: "TheHit",
      lastName: "Admin",
    })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: { email: adminEmail, firstName: "TheHit", lastName: "Admin", updatedAt: new Date() },
    })
    .returning();
  await db
    .insert(userProfilesTable)
    .values({
      userId: admin.id,
      displayName: "TheHit संपादकीय",
      bio: "TheHit.in की संपादकीय टीम। ज़मीनी पत्रकारिता, समुदाय की आवाज़।",
      role: "super_admin",
      isWriterApproved: true,
      isVerified: true,
      languagePref: "hi",
      followerCount: 142,
    })
    .onConflictDoUpdate({
      target: userProfilesTable.userId,
      set: {
        role: "super_admin",
        isWriterApproved: true,
        isVerified: true,
        displayName: "TheHit संपादकीय",
      },
    });

  // Full demo role matrix
  const seedUsers: Array<{
    id: string;
    first: string;
    last: string;
    display: string;
    bio: string;
    role: "super_admin" | "state_admin" | "district_admin" | "moderator" | "writer" | "reader";
    approved: boolean;
    verified: boolean;
    followers: number;
    lang?: "hi" | "en";
  }> = [
    { id: "state-admin", first: "राज्य", last: "एडमिन", display: "राज्य व्यवस्थापक", bio: "Chhattisgarh state-level administrator.", role: "state_admin", approved: true, verified: true, followers: 0 },
    { id: "district-admin-bastar", first: "बस्तर", last: "जिला", display: "बस्तर जिला एडमिन", bio: "Bastar district administrator.", role: "district_admin", approved: true, verified: true, followers: 0 },
    { id: "moderator-1", first: "मॉडरेटर", last: "एक", display: "मॉडरेटर — सरगुजा", bio: "Community moderator for Surguja division.", role: "moderator", approved: true, verified: true, followers: 0 },
    { id: "writer-rajesh", first: "राजेश", last: "नेताम", display: "राजेश नेताम", bio: "बस्तर संभाग — आदिवासी संस्कृति और स्थानीय शासन", role: "writer", approved: true, verified: true, followers: 86 },
    { id: "writer-anita", first: "अनीता", last: "मरकाम", display: "अनीता मरकाम", bio: "धमतरी — किसान, शिक्षा और महिला अधिकार", role: "writer", approved: true, verified: true, followers: 64 },
    { id: "writer-vikram", first: "विक्रम", last: "मांझी", display: "विक्रम मांझी", bio: "सरगुजा — वन अधिकार, पर्यावरण और खनन", role: "writer", approved: true, verified: true, followers: 51 },
    { id: "writer-priya", first: "प्रिया", last: "उइके", display: "Priya Uikey", bio: "Kanker — Forest Rights, governance, and youth", role: "writer", approved: true, verified: true, followers: 39, lang: "en" },
    { id: "writer-pending", first: "रोहित", last: "कोर्राम", display: "रोहित कोर्राम", bio: "Aspiring writer from Kondagaon.", role: "reader", approved: false, verified: false, followers: 0 },
    { id: "reader-demo", first: "पाठक", last: "उदाहरण", display: "Demo Reader", bio: "Regular reader account for demos.", role: "reader", approved: false, verified: false, followers: 0 },
  ];

  for (const w of seedUsers) {
    const [u] = await db
      .insert(usersTable)
      .values({ id: w.id, email: `${w.id}@thehit.in`, firstName: w.first, lastName: w.last })
      .onConflictDoUpdate({
        target: usersTable.id,
        set: { firstName: w.first, lastName: w.last, updatedAt: new Date() },
      })
      .returning();
    await db
      .insert(userProfilesTable)
      .values({
        userId: u.id,
        displayName: w.display,
        bio: w.bio,
        role: w.role,
        isWriterApproved: w.approved,
        isVerified: w.verified,
        languagePref: w.lang ?? "hi",
        followerCount: w.followers,
      })
      .onConflictDoUpdate({
        target: userProfilesTable.userId,
        set: {
          role: w.role,
          isWriterApproved: w.approved,
          isVerified: w.verified,
          displayName: w.display,
          bio: w.bio,
        },
      });
  }

  // Categories
  for (const c of CATEGORIES) {
    await db
      .insert(categoriesTable)
      .values(c)
      .onConflictDoUpdate({ target: categoriesTable.slug, set: { nameHi: c.nameHi, nameEn: c.nameEn, sortOrder: c.sortOrder } });
  }

  // Locations
  const slugToId = new Map<string, string>();
  for (const l of LOCATIONS) {
    const parentId = l.parent ? slugToId.get(l.parent) ?? null : null;
    const [existing] = await db
      .select()
      .from(locationsTable)
      .where(eq(locationsTable.slug, l.slug));
    if (existing) {
      slugToId.set(l.slug, existing.id);
      await db
        .update(locationsTable)
        .set({ nameHi: l.nameHi, nameEn: l.nameEn, type: l.type, parentId })
        .where(eq(locationsTable.id, existing.id));
    } else {
      const [row] = await db
        .insert(locationsTable)
        .values({ slug: l.slug, type: l.type, nameHi: l.nameHi, nameEn: l.nameEn, parentId })
        .returning();
      slugToId.set(l.slug, row.id);
    }
  }

  // Articles
  const cats = await db.select().from(categoriesTable);
  const catBySlug = new Map(cats.map((c) => [c.slug, c.id]));
  const writerIds = ["writer-rajesh", "writer-anita", "writer-vikram", "writer-priya", admin.id];

  await db.delete(articlesTable).where(sql`true`);
  for (let i = 0; i < ARTICLES.length; i++) {
    const a = ARTICLES[i];
    await db.insert(articlesTable).values({
      slug: slugify(a.title),
      title: a.title,
      summary: a.summary,
      body: a.body,
      coverImageUrl: COVERS[a.cover],
      lang: a.lang,
      status: "published",
      writerId: writerIds[i % writerIds.length],
      categoryId: catBySlug.get(a.category) ?? null,
      locationId: slugToId.get(a.location) ?? null,
      tags: [],
      isBreaking: a.isBreaking ?? false,
      isFeatured: a.isFeatured ?? false,
      viewCount: Math.floor(200 + Math.random() * 5000),
      likeCount: Math.floor(10 + Math.random() * 400),
      commentCount: Math.floor(0 + Math.random() * 30),
      shareCount: Math.floor(0 + Math.random() * 50),
      publishedAt: new Date(Date.now() - i * 6 * 60 * 60 * 1000),
    });
  }

  // Additional published filler articles to reach 20+
  const fillerTitles = [
    { title: "महासमुंद: मनरेगा में रिकॉर्ड भागीदारी, गाँवों में काम पूरा", category: "society", location: "raipur-state", cover: 5 },
    { title: "रायगढ़: कोयला परिवहन से धूल प्रदूषण, प्रशासन ने दिये निर्देश", category: "society", location: "raipur-state", cover: 3 },
    { title: "कोरबा: युवा महिलाओं ने शुरू किया हर्बल साबुन निर्माण कुटीर उद्योग", category: "society", location: "korba", cover: 4 },
    { title: "बस्तर हाट: स्थानीय किसानों के लिए नया डिजिटल भुगतान प्लेटफ़ॉर्म", category: "agriculture", location: "jagdalpur", cover: 2 },
    { title: "जशपुर: सरना धर्म कोड की मांग को लेकर पंचायत प्रतिनिधियों की बैठक", category: "politics", location: "bagicha", cover: 0 },
    { title: "Kanker: Tribal youth lead waste-segregation drive across 18 villages", category: "society", location: "kanker", cover: 5, lang: "en" as const },
    { title: "सरगुजा: सीताफल की खेती से बढ़ी छोटे किसानों की आय", category: "agriculture", location: "ambikapur", cover: 2 },
    { title: "धमतरी: सिकासेर बांध से रबी सिंचाई के लिए पानी छोड़ने का निर्णय", category: "agriculture", location: "nagri", cover: 5 },
    { title: "बीजापुर: नई सड़क ने 14 गाँवों को मुख्य बाजार से जोड़ा", category: "society", location: "bijapur", cover: 3 },
    { title: "रायपुर: स्कूल चलें हम के तहत 200 नए शिक्षकों की नियुक्ति", category: "education", location: "raipur-state", cover: 4 },
    { title: "बस्तर: युवा फुटबॉल अकादमी का शुभारंभ, 60 खिलाड़ी चयनित", category: "sports", location: "jagdalpur", cover: 1 },
    { title: "कोरबा: पारंपरिक धान बीज संरक्षण के लिए महिलाओं की पहल", category: "culture", location: "pali", cover: 2 },
  ];
  for (let i = 0; i < fillerTitles.length; i++) {
    const f = fillerTitles[i];
    await db.insert(articlesTable).values({
      slug: slugify(f.title),
      title: f.title,
      summary: f.title + "। यह रिपोर्ट हमारे संवाददाता द्वारा स्थानीय स्तर पर तैयार की गई है।",
      body: f.title + "। विस्तृत रिपोर्ट: स्थानीय ग्रामीणों, अधिकारियों और सामुदायिक कार्यकर्ताओं से बातचीत के आधार पर तैयार की गई यह रिपोर्ट क्षेत्र की मौजूदा स्थिति, चुनौतियाँ और आगे की राह पर रोशनी डालती है। हमारे संवाददाता ने तीन दिनों तक मौके पर रहकर सभी पक्षों से बात की।",
      coverImageUrl: COVERS[f.cover],
      lang: f.lang ?? "hi",
      status: "published",
      writerId: writerIds[i % writerIds.length],
      categoryId: catBySlug.get(f.category) ?? null,
      locationId: slugToId.get(f.location) ?? null,
      tags: [],
      isBreaking: false,
      isFeatured: i < 2,
      viewCount: Math.floor(100 + Math.random() * 3000),
      likeCount: Math.floor(5 + Math.random() * 250),
      commentCount: Math.floor(Math.random() * 20),
      shareCount: Math.floor(Math.random() * 30),
      publishedAt: new Date(Date.now() - (ARTICLES.length + i) * 4 * 60 * 60 * 1000),
    });
  }

  // Workflow-state demo articles
  await db.insert(articlesTable).values({
    slug: slugify("pending submission for moderation"),
    title: "बलौदाबाजार: नई जल विद्युत परियोजना से 12 गाँव विस्थापित होंगे",
    summary: "प्रस्तावित परियोजना से प्रभावित ग्रामीणों ने पुनर्वास नीति पर पारदर्शिता की मांग की है।",
    body: "बलौदाबाजार — प्रस्तावित जल विद्युत परियोजना से लगभग बारह गाँव प्रभावित होंगे। ग्रामीणों ने ग्राम सभा में चर्चा करते हुए पुनर्वास नीति में पारदर्शिता और भूमि के बदले भूमि की मांग रखी है। प्रशासन ने कहा है कि सभी प्रभावित परिवारों से व्यक्तिगत सहमति ली जाएगी।",
    lang: "hi",
    status: "pending",
    writerId: "writer-anita",
    tags: [],
    isBreaking: false,
    isFeatured: false,
  });

  await db.insert(articlesTable).values({
    slug: slugify("pending submission two"),
    title: "जशपुर: नया प्राथमिक स्वास्थ्य केंद्र अगले माह से चालू",
    summary: "दूरस्थ बगीचा क्षेत्र के लिए लंबे समय से प्रतीक्षित स्वास्थ्य केंद्र तैयार।",
    body: "जशपुर — बगीचा ब्लॉक के बारह गाँवों को सेवा देने वाला नया प्राथमिक स्वास्थ्य केंद्र अगले माह से चालू हो जाएगा। यहाँ डॉक्टर, नर्स और 24x7 आपातकालीन सेवाएँ उपलब्ध रहेंगी। ग्रामीणों ने इसे लंबे संघर्ष की जीत बताया।",
    lang: "hi",
    status: "pending",
    writerId: "writer-rajesh",
    tags: [],
    isBreaking: false,
    isFeatured: false,
  });

  await db.insert(articlesTable).values({
    slug: slugify("draft article preview"),
    title: "Draft: सरगुजा खनन क्षेत्र की प्रारंभिक जाँच रिपोर्ट",
    summary: "लेखक द्वारा अभी लिखी जा रही रिपोर्ट, समीक्षा के लिए तैयार नहीं।",
    body: "यह एक प्रारंभिक मसौदा है। संवाददाता अभी क्षेत्र में काम कर रहे हैं और जल्द ही पूर्ण रिपोर्ट सबमिट की जाएगी।",
    lang: "hi",
    status: "draft",
    writerId: "writer-vikram",
    tags: [],
    isBreaking: false,
    isFeatured: false,
  });

  await db.insert(articlesTable).values({
    slug: slugify("changes requested article"),
    title: "धमतरी: कथित अनियमितताओं की रिपोर्ट — स्रोत और पुष्टि आवश्यक",
    summary: "लेखक से अतिरिक्त स्रोत और तथ्य पुष्टि के साथ दोबारा सबमिट करने को कहा गया।",
    body: "धमतरी — स्थानीय खरीदी केंद्रों में कथित अनियमितताओं को लेकर शिकायतें मिली हैं। संवाददाता को सुझाव दिया गया है कि आरोपों की पुष्टि के लिए संबंधित अधिकारियों के बयान और दस्तावेज़ शामिल करें।",
    lang: "hi",
    status: "changes_requested",
    moderationNote: "कृपया आरोपों की पुष्टि के लिए संबंधित अधिकारी का बयान और सहायक दस्तावेज़ शामिल करें।",
    writerId: "writer-anita",
    tags: [],
    isBreaking: false,
    isFeatured: false,
  });

  await db.insert(articlesTable).values({
    slug: slugify("rejected article example"),
    title: "अस्वीकृत: अपुष्ट दावों वाली प्रारंभिक रिपोर्ट",
    summary: "इस रिपोर्ट को संपादकीय मानकों के अनुरूप नहीं पाया गया।",
    body: "रिपोर्ट में किए गए कई दावे स्रोतों से समर्थित नहीं हैं। लेखक से अनुरोध है कि बेहतर शोध के साथ नई रिपोर्ट प्रस्तुत करें।",
    lang: "hi",
    status: "rejected",
    moderationNote: "स्रोत और तथ्यात्मक पुष्टि की कमी; TheHit संपादकीय दिशानिर्देशों के अनुरूप नहीं।",
    writerId: "writer-priya",
    tags: [],
    isBreaking: false,
    isFeatured: false,
  });

  // Location resources (tehsil, police, hospital, etc.)
  const LOCATION_RESOURCES: Array<{
    location: string;
    category: "administration" | "police" | "health" | "education" | "emergency" | "utility" | "other";
    nameHi: string;
    nameEn: string;
    phone?: string;
    address?: string;
    mapsQuery?: string;
    sortOrder: number;
  }> = [
    // Jashpur
    { location: "jashpur", category: "administration", nameHi: "जिलाधिकारी कार्यालय, जशपुर", nameEn: "Collectorate, Jashpur", phone: "+917763223333", address: "Collectorate Building, Jashpur Nagar, Jashpur, Chhattisgarh 496331", mapsQuery: "Collectorate Jashpur Chhattisgarh", sortOrder: 1 },
    { location: "jashpur", category: "police", nameHi: "पुलिस अधीक्षक कार्यालय, जशपुर", nameEn: "SP Office, Jashpur", phone: "+917763220100", address: "SP Office, Jashpur Nagar, Chhattisgarh 496331", mapsQuery: "SP Office Jashpur", sortOrder: 2 },
    { location: "jashpur", category: "health", nameHi: "जिला अस्पताल, जशपुर", nameEn: "District Hospital, Jashpur", phone: "+917763220198", address: "District Hospital, Jashpur Nagar, Chhattisgarh 496331", mapsQuery: "District Hospital Jashpur", sortOrder: 3 },
    { location: "jashpur", category: "emergency", nameHi: "एम्बुलेंस सेवा (108)", nameEn: "Ambulance (108)", phone: "108", sortOrder: 4 },

    // Bastar
    { location: "bastar", category: "administration", nameHi: "जिलाधिकारी कार्यालय, जगदलपुर", nameEn: "Collectorate, Bastar (Jagdalpur)", phone: "+917782222204", address: "Collectorate, Jagdalpur, Bastar, Chhattisgarh 494001", mapsQuery: "Collectorate Jagdalpur Bastar", sortOrder: 1 },
    { location: "bastar", category: "police", nameHi: "पुलिस अधीक्षक कार्यालय, बस्तर", nameEn: "SP Office, Bastar", phone: "+917782229100", address: "SP Office, Jagdalpur, Bastar, Chhattisgarh 494001", mapsQuery: "SP Office Bastar Jagdalpur", sortOrder: 2 },
    { location: "bastar", category: "health", nameHi: "महारानी अस्पताल, जगदलपुर", nameEn: "Maharani Hospital, Jagdalpur", phone: "+917782222390", address: "Maharani Hospital, Jagdalpur, Bastar 494001", mapsQuery: "Maharani Hospital Jagdalpur", sortOrder: 3 },
    { location: "bastar", category: "emergency", nameHi: "एम्बुलेंस सेवा (108)", nameEn: "Ambulance (108)", phone: "108", sortOrder: 4 },

    // Dhamtari
    { location: "dhamtari", category: "administration", nameHi: "जिलाधिकारी कार्यालय, धमतरी", nameEn: "Collectorate, Dhamtari", phone: "+917722232101", address: "Collectorate, Dhamtari, Chhattisgarh 493773", mapsQuery: "Collectorate Dhamtari", sortOrder: 1 },
    { location: "dhamtari", category: "police", nameHi: "पुलिस अधीक्षक कार्यालय, धमतरी", nameEn: "SP Office, Dhamtari", phone: "+917722237100", address: "SP Office, Dhamtari, Chhattisgarh 493773", mapsQuery: "SP Office Dhamtari", sortOrder: 2 },
    { location: "dhamtari", category: "health", nameHi: "जिला अस्पताल, धमतरी", nameEn: "District Hospital, Dhamtari", phone: "+917722232120", address: "District Hospital, Dhamtari 493773", mapsQuery: "District Hospital Dhamtari", sortOrder: 3 },
    { location: "dhamtari", category: "emergency", nameHi: "एम्बुलेंस सेवा (108)", nameEn: "Ambulance (108)", phone: "108", sortOrder: 4 },

    // Kanker
    { location: "kanker", category: "administration", nameHi: "जिलाधिकारी कार्यालय, कांकेर", nameEn: "Collectorate, Kanker", phone: "+917868222001", address: "Collectorate, Kanker, Chhattisgarh 494334", mapsQuery: "Collectorate Kanker", sortOrder: 1 },
    { location: "kanker", category: "police", nameHi: "पुलिस अधीक्षक कार्यालय, कांकेर", nameEn: "SP Office, Kanker", phone: "+917868222100", address: "SP Office, Kanker 494334", mapsQuery: "SP Office Kanker", sortOrder: 2 },
    { location: "kanker", category: "health", nameHi: "जिला अस्पताल, कांकेर", nameEn: "District Hospital, Kanker", phone: "+917868222220", address: "District Hospital, Kanker 494334", mapsQuery: "District Hospital Kanker", sortOrder: 3 },
    { location: "kanker", category: "emergency", nameHi: "एम्बुलेंस सेवा (108)", nameEn: "Ambulance (108)", phone: "108", sortOrder: 4 },

    // Korba
    { location: "korba", category: "administration", nameHi: "जिलाधिकारी कार्यालय, कोरबा", nameEn: "Collectorate, Korba", phone: "+917759222001", address: "Collectorate, Korba, Chhattisgarh 495677", mapsQuery: "Collectorate Korba", sortOrder: 1 },
    { location: "korba", category: "police", nameHi: "पुलिस अधीक्षक कार्यालय, कोरबा", nameEn: "SP Office, Korba", phone: "+917759228100", address: "SP Office, Korba 495677", mapsQuery: "SP Office Korba", sortOrder: 2 },
    { location: "korba", category: "health", nameHi: "जिला अस्पताल, कोरबा", nameEn: "District Hospital, Korba", phone: "+917759222230", address: "District Hospital, Korba 495677", mapsQuery: "District Hospital Korba", sortOrder: 3 },
    { location: "korba", category: "emergency", nameHi: "एम्बुलेंस सेवा (108)", nameEn: "Ambulance (108)", phone: "108", sortOrder: 4 },

    // Surguja
    { location: "surguja", category: "administration", nameHi: "जिलाधिकारी कार्यालय, अंबिकापुर", nameEn: "Collectorate, Surguja (Ambikapur)", phone: "+917774222001", address: "Collectorate, Ambikapur, Surguja, Chhattisgarh 497001", mapsQuery: "Collectorate Ambikapur Surguja", sortOrder: 1 },
    { location: "surguja", category: "police", nameHi: "पुलिस अधीक्षक कार्यालय, सरगुजा", nameEn: "SP Office, Surguja", phone: "+917774223100", address: "SP Office, Ambikapur, Surguja 497001", mapsQuery: "SP Office Ambikapur Surguja", sortOrder: 2 },
    { location: "surguja", category: "health", nameHi: "मेडिकल कॉलेज अस्पताल, अंबिकापुर", nameEn: "Medical College Hospital, Ambikapur", phone: "+917774222400", address: "Medical College Hospital, Ambikapur 497001", mapsQuery: "Medical College Hospital Ambikapur", sortOrder: 3 },
    { location: "surguja", category: "emergency", nameHi: "एम्बुलेंस सेवा (108)", nameEn: "Ambulance (108)", phone: "108", sortOrder: 4 },

    // Bijapur
    { location: "bijapur-district", category: "administration", nameHi: "जिलाधिकारी कार्यालय, बीजापुर", nameEn: "Collectorate, Bijapur", phone: "+917853220001", address: "Collectorate, Bijapur, Chhattisgarh 494444", mapsQuery: "Collectorate Bijapur Chhattisgarh", sortOrder: 1 },
    { location: "bijapur-district", category: "police", nameHi: "पुलिस अधीक्षक कार्यालय, बीजापुर", nameEn: "SP Office, Bijapur", phone: "+917853220100", address: "SP Office, Bijapur 494444", mapsQuery: "SP Office Bijapur Chhattisgarh", sortOrder: 2 },
    { location: "bijapur-district", category: "health", nameHi: "जिला अस्पताल, बीजापुर", nameEn: "District Hospital, Bijapur", phone: "+917853220150", address: "District Hospital, Bijapur 494444", mapsQuery: "District Hospital Bijapur Chhattisgarh", sortOrder: 3 },
    { location: "bijapur-district", category: "emergency", nameHi: "एम्बुलेंस सेवा (108)", nameEn: "Ambulance (108)", phone: "108", sortOrder: 4 },

    // State-level
    { location: "raipur-state", category: "administration", nameHi: "मंत्रालय, छत्तीसगढ़ शासन", nameEn: "Mantralaya, Govt. of Chhattisgarh", phone: "+917712510000", address: "Mantralaya, Mahanadi Bhawan, Naya Raipur, Chhattisgarh 492002", mapsQuery: "Mantralaya Mahanadi Bhawan Naya Raipur", sortOrder: 1 },
    { location: "raipur-state", category: "emergency", nameHi: "पुलिस आपातकालीन (112)", nameEn: "Police Emergency (112)", phone: "112", sortOrder: 2 },
    { location: "raipur-state", category: "emergency", nameHi: "महिला हेल्पलाइन (1091)", nameEn: "Women Helpline (1091)", phone: "1091", sortOrder: 3 },
    { location: "raipur-state", category: "emergency", nameHi: "बाल हेल्पलाइन (1098)", nameEn: "Child Helpline (1098)", phone: "1098", sortOrder: 4 },
  ];

  await db.delete(locationResourcesTable).where(sql`true`);
  for (const r of LOCATION_RESOURCES) {
    const locId = slugToId.get(r.location);
    if (!locId) continue;
    await db.insert(locationResourcesTable).values({
      locationId: locId,
      category: r.category,
      nameHi: r.nameHi,
      nameEn: r.nameEn,
      phone: r.phone ?? null,
      address: r.address ?? null,
      mapsQuery: r.mapsQuery ?? null,
      sortOrder: r.sortOrder,
    });
  }

  // Writer applications
  await db.delete(writerApplicationsTable).where(sql`true`);
  await db.insert(writerApplicationsTable).values([
    {
      userId: "writer-pending",
      fullName: "रोहित कोर्राम",
      bio: "Kondagaon निवासी — पिछले तीन वर्षों से सामुदायिक रेडियो के लिए रिपोर्टिंग। मातृभाषा गोंडी, हिन्दी में लेखन।",
      sampleLink: "https://example.org/rohit-sample-1",
      status: "pending",
    },
    {
      userId: "reader-demo",
      fullName: "Demo Reader",
      bio: "Interested in covering forest rights and tribal education in Sarguja division.",
      sampleLink: "https://example.org/demo-sample",
      status: "pending",
    },
  ]);

  logger.info("Seed complete.");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Seed failed");
  process.exit(1);
});
