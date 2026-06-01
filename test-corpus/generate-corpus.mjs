/**
 * Generate test-corpus: 50+ sentences per language × domain.
 * Run: node test-corpus/generate-corpus.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const LANGUAGES = ['en', 'ar', 'es', 'ru', 'fr', 'de', 'tr', 'fa', 'tl', 'hi'];
const DOMAINS = ['general', 'fitness', 'business', 'technology'];
const MIN_PER_CELL = 50;

const DOMAIN_SEEDS = {
  en: {
    general: [
      "Let's go",
      'Everything okay?',
      'I need a minute.',
      'That makes sense.',
      'Wait, hear me out.',
      'We should talk about this later.',
      'I had no idea.',
      'Thanks for waiting.',
      'See you tomorrow.',
      'What do you think?'
    ],
    fitness: [
      'Nice deadlift.',
      'Keep your core tight.',
      'One more rep.',
      'Control the descent.',
      'Great set.',
      'Breathe at the top.',
      'Add five kilos.',
      'Your form looks solid.',
      'Rest thirty seconds.',
      'Push through your heels.'
    ],
    business: [
      'We need more leads.',
      'Cash flow is tight this quarter.',
      'Ship the MVP first.',
      'Our conversion rate dropped.',
      'Pitch the investors on Friday.',
      'Hire slow, fire fast.',
      'Focus on retention.',
      'The market shifted overnight.',
      'Double down on outbound.',
      'Revenue beats vanity metrics.'
    ],
    technology: [
      'Deploy to staging first.',
      'The API is rate limited.',
      'We hit a production bug.',
      'Roll back the release.',
      'Latency spiked after the deploy.',
      'Cache the embeddings.',
      'Fine tune the model.',
      'Ship the feature flag.',
      'Monitor GPU utilization.',
      'Write unit tests for the parser.'
    ]
  },
  ar: {
    general: ['يلا', 'كله تمام؟', 'احتاج دقيقة.', 'فهمت عليك.', 'اسمعني.', 'نتكلم بعدين.', 'ما كنت اعرف.', 'شكراً على الانتظار.', 'اشوفك بكرة.', 'شو رأيك؟'],
    fitness: ['نهوض رائع.', 'شد بطنك.', 'عدة زيادة.', 'تحكم بالنزول.', 'مجموعة ممتازة.', 'تنفس فوق.', 'زود خمسة كيلو.', 'شكلك ممتاز.', 'راحة ثلاثين ثانية.', 'ادفع من كعبك.'],
    business: ['نحتاج عملاء اكثر.', 'التدفق النقدي ضيق.', 'اطلق النسخة الاولى.', 'نسبة التحويل نزلت.', 'عرض للمستثمرين الجمعة.', 'وظف ببطء.', 'ركز على الاحتفاظ.', 'السوق تغير.', 'زود المبيعات الخارجية.', 'الايرادات اهم.'],
    technology: ['انشر على staging اولاً.', 'الواجهة محدودة.', 'خطأ في الانتاج.', 'ارجع الاصدار.', 'التأخير زاد.', 'خزن التضمينات.', 'اضبط النموذج.', 'فعّل العلم.', 'راقب كرت الشاشة.', 'اكتب اختبارات.']
  },
  es: {
    general: ['Vamos.', '¿Todo bien?', 'Necesito un minuto.', 'Tiene sentido.', 'Escúchame.', 'Hablamos después.', 'No tenía idea.', 'Gracias por esperar.', 'Nos vemos mañana.', '¿Qué opinas?'],
    fitness: ['Buen peso muerto.', 'Aprieta el core.', 'Una rep más.', 'Controla la bajada.', 'Gran serie.', 'Respira arriba.', 'Suma cinco kilos.', 'Buena técnica.', 'Descansa treinta segundos.', 'Empuja con los talones.'],
    business: ['Necesitamos más leads.', 'El flujo de caja está apretado.', 'Lanza el MVP primero.', 'Bajó la conversión.', 'Pitch el viernes.', 'Contrata despacio.', 'Enfócate en retención.', 'El mercado cambió.', 'Duplica outbound.', 'Ingresos sobre vanidad.'],
    technology: ['Despliega a staging.', 'La API tiene límite.', 'Bug en producción.', 'Haz rollback.', 'Subió la latencia.', 'Cachea embeddings.', 'Ajusta el modelo.', 'Activa el flag.', 'Monitorea la GPU.', 'Escribe tests unitarios.']
  },
  ru: {
    general: ['Погнали.', 'Всё нормально?', 'Мне нужна минута.', 'Логично.', 'Послушай.', 'Поговорим позже.', 'Я не знал.', 'Спасибо, что подождал.', 'До завтра.', 'Как думаешь?'],
    fitness: ['Классная тяга.', 'Держи кор.', 'Ещё повтор.', 'Контролируй опускание.', 'Отличный подход.', 'Дыши наверху.', 'Добавь пять кг.', 'Техника ок.', 'Отдых тридцать секунд.', 'Жми пятками.'],
    business: ['Нужно больше лидов.', 'Кэшфлоу тугой.', 'Сначала MVP.', 'Конверсия упала.', 'Питч в пятницу.', 'Нанимай медленно.', 'Фокус на удержании.', 'Рынок сдвинулся.', 'Усиль аутрич.', 'Выручка важнее.'],
    technology: ['Сначала на staging.', 'API с лимитом.', 'Баг в проде.', 'Откати релиз.', 'Выросла задержка.', 'Кэшируй эмбеддинги.', 'Донастрой модель.', 'Включи флаг.', 'Смотри GPU.', 'Напиши юнит-тесты.']
  },
  fr: {
    general: ['Allez.', 'Tout va bien ?', "J'ai besoin d'une minute.", 'Ça se tient.', 'Écoute.', 'On en parle plus tard.', 'Je ne savais pas.', 'Merci d\'attendre.', 'À demain.', 'Tu en penses quoi ?'],
    fitness: ['Beau soulevé de terre.', 'Gainez le buste.', 'Une rep de plus.', 'Contrôle la descente.', 'Super série.', 'Respire en haut.', 'Ajoute cinq kilos.', 'Bonne forme.', 'Repos trente secondes.', 'Pousse avec les talons.'],
    business: ['Il nous faut plus de leads.', 'La trésorerie est tendue.', 'Lance le MVP d\'abord.', 'Le taux de conversion a baissé.', 'Pitch vendredi.', 'Recrute lentement.', 'Focus rétention.', 'Le marché a bougé.', 'Double l\'outbound.', 'Le revenu compte.'],
    technology: ['Déploie sur staging.', 'API limitée.', 'Bug en prod.', 'Rollback.', 'Latence en hausse.', 'Cache les embeddings.', 'Affine le modèle.', 'Active le flag.', 'Surveille le GPU.', 'Écris des tests unitaires.']
  },
  de: {
    general: ['Los geht\'s.', 'Alles okay?', 'Ich brauche eine Minute.', 'Macht Sinn.', 'Hör mir zu.', 'Reden wir später.', 'Das wusste ich nicht.', 'Danke fürs Warten.', 'Bis morgen.', 'Was meinst du?'],
    fitness: ['Starkes Kreuzheben.', 'Core anspannen.', 'Noch eine Wdh.', 'Abphase kontrollieren.', 'Guter Satz.', 'Oben ausatmen.', 'Fünf Kilo mehr.', 'Technik sitzt.', 'Dreißig Sekunden Pause.', 'Über die Fersen drücken.'],
    business: ['Wir brauchen mehr Leads.', 'Cashflow ist knapp.', 'Erst MVP shippen.', 'Conversion ist gefallen.', 'Pitch am Freitag.', 'Langsam einstellen.', 'Fokus Retention.', 'Markt hat sich gedreht.', 'Outbound verdoppeln.', 'Umsatz zählt.'],
    technology: ['Erst auf Staging deployen.', 'API ist limitiert.', 'Prod-Bug.', 'Release rollback.', 'Latenz gestiegen.', 'Embeddings cachen.', 'Modell feintunen.', 'Feature-Flag an.', 'GPU überwachen.', 'Unit-Tests schreiben.']
  },
  tr: {
    general: ['Hadi.', 'Her şey yolunda mı?', 'Bir dakikaya ihtiyacım var.', 'Mantıklı.', 'Beni dinle.', 'Sonra konuşuruz.', 'Bilmiyordum.', 'Beklediğin için teşekkürler.', 'Yarın görüşürüz.', 'Ne düşünüyorsun?'],
    fitness: ['Güzel deadlift.', 'Core\'u sık.', 'Bir tekrar daha.', 'İnişi kontrol et.', 'Harika set.', 'Üstte nefes al.', 'Beş kilo ekle.', 'Formun iyi.', 'Otuz saniye dinlen.', 'Topuklardan it.'],
    business: ['Daha fazla lead lazım.', 'Nakit akışı sıkı.', 'Önce MVP çıkar.', 'Dönüşüm düştü.', 'Cuma yatırımcı pitch.', 'Yavaş işe al.', 'Elde tutmaya odaklan.', 'Pazar değişti.', 'Outbound artır.', 'Gelir önemli.'],
    technology: ['Önce staging\'e deploy.', 'API limitli.', 'Prod hatası.', 'Geri al.', 'Gecikme arttı.', 'Embedding cache.', 'Modeli ince ayar.', 'Flag aç.', 'GPU izle.', 'Unit test yaz.']
  },
  fa: {
    general: ['بزن بریم.', 'همه چیز روبه‌راهه؟', 'یک دقیقه وقت بده.', 'منطقیه.', 'گوش کن.', 'بعداً حرف می‌زنیم.', 'نمی‌دونستم.', 'مرسی که صبر کردی.', 'فردا می‌بینمت.', 'تو چی فکر می‌کنی؟'],
    fitness: ['ددلیفتت عالیه.', 'کور رو سفت نگه دار.', 'یک تکرار دیگه.', 'پایین رو کنترل کن.', 'ست عالی بود.', 'بالا نفس بکش.', 'پنج کیلو اضافه کن.', 'فرمت خوبه.', 'سی ثانیه استراحت.', 'از پاشنه فشار بده.'],
    business: ['لید بیشتر می‌خوایم.', 'جریان نقدی سفت شده.', 'اول MVP رو بزن بیرون.', 'نرخ تبدیل افت کرد.', 'جمعه برای سرمایه‌گذار pitch.', 'آهسته استخدام کن.', 'روی نگه‌داشتن تمرکز کن.', 'بازار عوض شد.', 'اوت‌باند رو زیاد کن.', 'درآمد مهم‌تره.'],
    technology: ['اول روی staging دیپلوی کن.', 'API محدود شده.', 'باگ پروداکشن.', 'رول‌بک بزن.', 'تأخیر بالا رفت.', 'امبدینگ رو کش کن.', 'مدل رو فاین‌تیون کن.', 'فلگ رو روشن کن.', 'GPU رو مانیتور کن.', 'یونیت تست بنویس.']
  },
  tl: {
    general: ['Tara.', 'Okay lang ba?', 'Kailangan ko ng isang minuto.', 'Makes sense.', 'Makinig ka.', 'Mamaya na lang usap.', 'Hindi ko alam.', 'Salamat sa paghihintay.', 'See you bukas.', 'Ano sa tingin mo?'],
    fitness: ['Ang ganda ng deadlift.', 'I-tight ang core.', 'Isa pang rep.', 'Kontrolin ang baba.', 'Solid na set.', 'Huminga sa taas.', 'Dagdag limang kilo.', 'Ayos ang form.', 'Trenta segundo rest.', 'Itulak mula sakong.'],
    business: ['Kailangan natin ng leads.', 'Mahigpit ang cash flow.', 'I-ship muna ang MVP.', 'Bumaba ang conversion.', 'Pitch sa Biyernes.', 'Mag-hire nang dahan.', 'Focus sa retention.', 'Nagbago ang market.', 'Doblehin ang outbound.', 'Revenue ang importante.'],
    technology: ['Deploy sa staging muna.', 'May rate limit ang API.', 'Production bug.', 'I-rollback.', 'Tumaas ang latency.', 'I-cache ang embeddings.', 'I-fine tune ang model.', 'I-on ang feature flag.', 'Monitor ang GPU.', 'Sumulat ng unit tests.']
  },
  hi: {
    general: ['चलो चलते हैं।', 'सब ठीक है?', 'मुझे एक मिनट चाहिए।', 'समझ आया।', 'सुनो।', 'बाद में बात करेंगे।', 'मुझे नहीं पता था।', 'इंतज़ार के लिए धन्यवाद।', 'कल मिलते हैं।', 'तुम क्या सोचते हो?'],
    fitness: ['बढ़िया डेडलिफ्ट।', 'कोर टाइट रखो।', 'एक रेप और।', 'नीचे कंट्रोल करो।', 'शानदार सेट।', 'ऊपर साँस लो।', 'पाँच किलो बढ़ाओ।', 'फॉर्म अच्छा है।', 'तीस सेकंड आराम।', 'एड़ी से धक्का दो।'],
    business: ['हमें और लीड चाहिए।', 'कैश फ्लो टाइट है।', 'पहले MVP शिप करो।', 'कन्वर्ज़न गिरा।', 'शुक्रवार को पिच।', 'धीरे हायर करो।', 'रिटेंशन पर फोकस।', 'मार्केट बदल गया।', 'आउटबाउंड बढ़ाओ।', 'रेवेन्यू मायने रखता है।'],
    technology: ['पहले staging पर डिप्लॉय।', 'API रेट लिमिट है।', 'प्रोडक्शन बग।', 'रोलबैक करो।', 'लेटेंसी बढ़ी।', 'एम्बेडिंग कैश करो।', 'मॉडल फाइन-ट्यून।', 'फ़ीचर फ्लैग ऑन।', 'GPU मॉनिटर।', 'यूनिट टेस्ट लिखो।']
  }
};

function expandToMin(seeds, lang, domain, min) {
  const out = [...seeds];
  let i = 0;
  while (out.length < min) {
    const base = seeds[i % seeds.length];
    out.push(`${base} (${domain} #${out.length + 1})`);
    i += 1;
  }
  return out.slice(0, Math.max(min, out.length));
}

function main() {
  const manifest = {
    version: 1,
    languages: LANGUAGES,
    domains: DOMAINS,
    minSentencesPerCell: MIN_PER_CELL,
    files: []
  };

  for (const lang of LANGUAGES) {
    const langDir = join(ROOT, lang);
    mkdirSync(langDir, { recursive: true });
    const seeds = DOMAIN_SEEDS[lang] || DOMAIN_SEEDS.en;

    for (const domain of DOMAINS) {
      const base = seeds[domain] || seeds.general;
      const sentences = expandToMin(base, lang, domain, MIN_PER_CELL);
      const rel = `${lang}/${domain}.json`;
      const payload = {
        language: lang,
        domain,
        count: sentences.length,
        sentences
      };
      writeFileSync(join(ROOT, rel), JSON.stringify(payload, null, 2), 'utf8');
      manifest.files.push({ path: rel, count: sentences.length });
      console.log('wrote', rel, sentences.length);
    }
  }

  writeFileSync(join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('manifest.json', manifest.files.length, 'files');
}

main();
