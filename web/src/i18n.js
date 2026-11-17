// Citizen-facing strings. Control-room screens stay in English (officials' working language).
export const LANGS = [
  { id: "en", label: "English" },
  { id: "te", label: "తెలుగు" },
  { id: "ta", label: "தமிழ்" },
];

const S = {
  helpNow: { en: "I need help now", te: "నాకు ఇప్పుడే సహాయం కావాలి", ta: "எனக்கு இப்போதே உதவி வேண்டும்" },
  helpNowSub: {
    en: "Call first. Then keep the person still and warm until help arrives.",
    te: "ముందు కాల్ చేయండి. సహాయం వచ్చే వరకు వ్యక్తిని కదలకుండా, వెచ్చగా ఉంచండి.",
    ta: "முதலில் அழையுங்கள். உதவி வரும் வரை நபரை அசைக்காமல், கதகதப்பாக வைத்திருங்கள்.",
  },
  whereToGo: { en: "Where to take the injured", te: "గాయపడిన వారిని ఎక్కడికి తీసుకెళ్లాలి", ta: "காயமடைந்தவரை எங்கே அழைத்துச் செல்ல வேண்டும்" },
  traumaGap: {
    en: "There is no dedicated trauma centre on the highways of Chittoor or Tirupati districts. Stabilise at Nagari, then shift serious injuries to Tirupati quickly.",
    te: "చిత్తూరు, తిరుపతి జిల్లాల హైవేలపై ప్రత్యేక ట్రామా సెంటర్ లేదు. నగరిలో ప్రాథమిక చికిత్స తర్వాత, తీవ్ర గాయాలను త్వరగా తిరుపతికి తరలించండి.",
    ta: "சித்தூர், திருப்பதி மாவட்ட நெடுஞ்சாலைகளில் தனி அதிர்ச்சி சிகிச்சை மையம் இல்லை. நகரியில் முதலுதவிக்குப் பின், கடுமையான காயங்களை விரைவாக திருப்பதிக்கு மாற்றுங்கள்.",
  },
  samaritanTitle: { en: "You will not get into trouble for helping", te: "సహాయం చేసినందుకు మీకు ఇబ్బంది ఉండదు", ta: "உதவி செய்ததற்காக உங்களுக்கு எந்த பிரச்சனையும் இல்லை" },
  samaritan1: { en: "You don't have to give your name, phone number or address to police or hospital.", te: "పోలీసులకు లేదా ఆసుపత్రికి మీ పేరు, ఫోన్ నంబర్, చిరునామా ఇవ్వాల్సిన అవసరం లేదు.", ta: "காவல்துறை அல்லது மருத்துவமனைக்கு உங்கள் பெயர், தொலைபேசி எண், முகவரி தர வேண்டியதில்லை." },
  samaritan2: { en: "You cannot be held at the hospital or asked to pay.", te: "మిమ్మల్ని ఆసుపత్రిలో ఆపకూడదు, డబ్బు అడగకూడదు.", ta: "உங்களை மருத்துவமனையில் தடுத்து வைக்கவோ பணம் கேட்கவோ கூடாது." },
  samaritan3: { en: "The law protects you even if something goes wrong while helping.", te: "సహాయం చేస్తుండగా ఏదైనా జరిగినా చట్టం మిమ్మల్ని రక్షిస్తుంది.", ta: "உதவும்போது ஏதேனும் தவறு நடந்தாலும் சட்டம் உங்களைப் பாதுகாக்கும்." },
  firstAid: { en: "First aid: do and don't", te: "ప్రథమ చికిత్స: చేయాల్సినవి, చేయకూడనివి", ta: "முதலுதவி: செய்ய வேண்டியவை, கூடாதவை" },
  sosTitle: { en: "Send your location to family", te: "మీ లొకేషన్‌ను కుటుంబానికి పంపండి", ta: "உங்கள் இருப்பிடத்தை குடும்பத்துக்கு அனுப்புங்கள்" },
  sosLandmark: { en: "Nearest landmark", te: "దగ్గరలోని గుర్తు", ta: "அருகிலுள்ள அடையாளம்" },
  copyMsg: { en: "Copy message", te: "సందేశం కాపీ చేయండి", ta: "செய்தியை நகலெடுக்கவும்" },
  copied: { en: "Copied. Paste it in WhatsApp or SMS.", te: "కాపీ అయింది. WhatsApp లేదా SMS లో పేస్ట్ చేయండి.", ta: "நகலெடுக்கப்பட்டது. WhatsApp அல்லது SMS-ல் ஒட்டுங்கள்." },

  services: { en: "What do you need?", te: "మీకు ఏం కావాలి?", ta: "உங்களுக்கு என்ன வேண்டும்?" },
  svcFamily: { en: "Someone I love was in an accident", te: "నా కుటుంబ సభ్యులు ప్రమాదానికి గురయ్యారు", ta: "என் அன்புக்குரியவர் விபத்தில் சிக்கினார்" },
  svcRoute: { en: "Is my route safe today?", te: "ఈ రోజు నా దారి సురక్షితమేనా?", ta: "இன்று என் பாதை பாதுகாப்பானதா?" },
  svcReport: { en: "Report a road hazard", te: "రోడ్డు ప్రమాదాన్ని తెలియజేయండి", ta: "சாலை ஆபத்தை தெரிவிக்கவும்" },
  svcTrack: { en: "Is anyone fixing it?", te: "ఎవరైనా సరిచేస్తున్నారా?", ta: "யாராவது சரிசெய்கிறார்களா?" },

  famTitle: { en: "Family case companion", te: "కుటుంబ సహాయ మార్గదర్శి", ta: "குடும்ப வழிகாட்டி" },
  famIntro: {
    en: "We're sorry for what your family is going through. Tell us three things and we'll show what to do next, one step at a time. Nothing you enter leaves this device.",
    te: "మీ కుటుంబం ఎదుర్కొంటున్న బాధకు మేము చింతిస్తున్నాము. మూడు విషయాలు చెప్పండి, తర్వాత ఏం చేయాలో ఒక్కో అడుగుగా చూపిస్తాము. మీరు ఇచ్చే సమాచారం ఈ ఫోన్ దాటి వెళ్లదు.",
    ta: "உங்கள் குடும்பம் அனுபவிக்கும் துயரத்திற்கு வருந்துகிறோம். மூன்று விஷயங்களைச் சொல்லுங்கள், அடுத்து என்ன செய்ய வேண்டும் என்பதை ஒவ்வொரு படியாகக் காட்டுகிறோம். நீங்கள் தரும் தகவல் இந்த சாதனத்தை விட்டு வெளியே போகாது.",
  },
  accDate: { en: "Date of accident", te: "ప్రమాదం జరిగిన తేదీ", ta: "விபத்து நடந்த தேதி" },
  outcome: { en: "What happened", te: "ఏం జరిగింది", ta: "என்ன நடந்தது" },
  injured: { en: "Injured", te: "గాయపడ్డారు", ta: "காயமடைந்தார்" },
  died: { en: "We lost them", te: "మేము వారిని కోల్పోయాము", ta: "அவரை இழந்தோம்" },
  vehicle: { en: "The other vehicle", te: "ఢీకొట్టిన వాహనం", ta: "மோதிய வாகனம்" },
  vKnown: { en: "Known / traced", te: "తెలుసు", ta: "தெரியும்" },
  vHitRun: { en: "Hit and run", te: "ఢీకొట్టి పారిపోయారు", ta: "மோதிவிட்டு ஓடிவிட்டார்" },
  vUnsure: { en: "Not sure yet", te: "ఇంకా తెలియదు", ta: "இன்னும் தெரியவில்லை" },
  deadlines: { en: "Important dates", te: "ముఖ్యమైన తేదీలు", ta: "முக்கியமான தேதிகள்" },
  roadmap: { en: "Your step-by-step roadmap", te: "మీ అడుగడుగు మార్గదర్శి", ta: "உங்கள் படிப்படியான வழிகாட்டி" },
  saved: { en: "Ticks are saved on this device only.", te: "టిక్‌లు ఈ పరికరంలో మాత్రమే సేవ్ అవుతాయి.", ta: "குறிகள் இந்த சாதனத்தில் மட்டுமே சேமிக்கப்படும்." },
  copyList: { en: "Copy checklist for a relative", te: "బంధువుల కోసం జాబితా కాపీ చేయండి", ta: "உறவினருக்காக பட்டியலை நகலெடுக்கவும்" },
  estimator: { en: "What compensation can the family expect?", te: "కుటుంబానికి ఎంత పరిహారం రావచ్చు?", ta: "குடும்பத்துக்கு எவ்வளவு இழப்பீடு கிடைக்கலாம்?" },
  rights: { en: "Know your rights", te: "మీ హక్కులు తెలుసుకోండి", ta: "உங்கள் உரிமைகளை அறியுங்கள்" },
  talk: { en: "Talk to someone", te: "ఎవరితోనైనా మాట్లాడండి", ta: "யாரிடமாவது பேசுங்கள்" },

  routeTitle: { en: "Route safety check", te: "దారి భద్రత తనిఖీ", ta: "பாதை பாதுகாப்பு சோதனை" },
  day: { en: "Day", te: "పగలు", ta: "பகல்" },
  night: { en: "Night", te: "రాత్రి", ta: "இரவு" },
  reportTitle: { en: "Report a hazard", te: "ప్రమాదాన్ని తెలియజేయండి", ta: "ஆபத்தை தெரிவிக்கவும்" },
  ledgerTitle: { en: "Who is fixing what", te: "ఎవరు ఏం సరిచేస్తున్నారు", ta: "யார் எதை சரிசெய்கிறார்கள்" },
};

export function t(key, lang) {
  const e = S[key];
  if (!e) return key;
  return e[lang] || e.en;
}
