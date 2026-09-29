// All player-facing text (Arabic).
export const T = {
  title: 'لمّتنا', subtitle: 'صالة المرح',
  tapToStart: 'اضغط للبدء',
  createRoom: 'غرفة جديدة', joinRoom: 'انضم إلى غرفة', solo: 'العب على هذا الجهاز',
  codePlaceholder: 'رمز الغرفة', join: 'دخول', back: 'رجوع',
  noServer: 'اللعب الجماعي يحتاج خادم الغرف. يمكنك اللعب الآن على هذا الجهاز.',
  connecting: 'جارٍ الاتصال…', connectFailed: 'تعذّر الاتصال بخادم الغرف',
  chooseCharacter: 'اختر شخصيتك', taken: 'مع لاعب آخر', you: 'أنت',
  room: 'غرفة', invite: 'دعوة', copied: 'تم نسخ رابط الدعوة', shareText: 'تعالوا نلعب معًا في لمّتنا!',
  menu: 'القائمة', familyRound: 'جولة عائلية', freePlay: 'لعب حر', assist: 'مساعدة الصغار', sound: 'الصوت', leave: 'خروج',
  hostOnly: 'صاحب الغرفة فقط يبدأ الجولة العائلية',
  ride: 'اركب', getOff: 'انزل', slide: 'انزلق', pickUp: 'التقط', put: 'ضع', drop: 'أنزل', passTo: 'مرّر إلى', start: 'ابدأ',
  jump: 'قفز',
  errors: {
    'no-room': 'لا توجد غرفة بهذا الرمز', full: 'الغرفة ممتلئة (٥ لاعبين)', taken: 'هذه الشخصية مع لاعب آخر',
    occupied: 'مشغولة الآن', far: 'اقترب أكثر', 'wrong-basket': 'سلة بلون آخر', 'host-only': 'صاحب الغرفة فقط يبدأ الجولة العائلية'
  },
  lost: 'انقطع الاتصال… نحاول مجددًا', reconnected: 'عاد الاتصال',
  race: 'سباق الملعب', rescue: 'إنقاذ الكرات', celebrate: 'حفلة العائلة',
  raceDemo: ['نفق', 'قفز', 'سلالم', 'زحليقة'], raceGoal: 'اتبع الأسهم حتى بركة الكرات',
  rescueDemo: 'ضع كل كرة في سلة بنفس اللون والرمز', rescueGoal: 'كرات العائلة',
  go: 'انطلق!', finished: 'وصلت!', place: n => ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس'][n] || '',
  timeUp: 'انتهى الوقت', success: 'أحسنتم!', almost: 'اقتربتم! مرة أخرى؟',
  everyone: 'رائع يا عائلة!', seconds: 'ث',
  badges: {
    fastest: { icon: '🏃', name: 'أسرع متسابق' },
    finisher: { icon: '🏁', name: 'بطل الوصول' },
    collector: { icon: '🧺', name: 'أفضل جامع كرات' },
    helper: { icon: '🤝', name: 'أكثر فرد متعاون' },
    joy: { icon: '🎈', name: 'نجم المرح' }
  },
  away: 'غير متصل مؤقتًا', joined: 'انضم', backOnline: 'عاد'
};

export function arabicDigits(n) {
  return String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
}
