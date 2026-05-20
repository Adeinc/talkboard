/* ============================================================
   i18n.js — interface translations for TalkBoard
   ------------------------------------------------------------
   Languages: English, Nigerian Pidgin, Yoruba, Hausa, Igbo.

   This translates the INTERFACE only (buttons, labels, menus) —
   not what members write in their Talks and replies.

   >>> IMPORTANT: before a public launch, have a native speaker
   review the Yoruba, Hausa and Igbo wording below. UI phrasing
   has nuances that only a native speaker reliably catches.
   Each string is keyed and grouped — corrections are quick.
   Any key missing from a language automatically falls back to
   English, so a partial translation is always safe.
   ============================================================ */
window.I18N = {
  // language list shown in the switcher
  LANGS: [
    { code: 'en',  label: 'English' },
    { code: 'pcm', label: 'Pidgin' },
    { code: 'yo',  label: 'Yorùbá' },
    { code: 'ha',  label: 'Hausa' },
    { code: 'ig',  label: 'Igbo' },
  ],

  STRINGS: {
    /* ---- navigation & general ---- */
    'nav.all':        { en:'All',           pcm:'All',            yo:'Gbogbo rẹ̀',     ha:'Duka',          ig:'Ha niile' },
    'nav.home':       { en:'Home',          pcm:'Home',           yo:'Ilé',            ha:'Gida',          ig:'Ụlọ' },
    'btn.signin':     { en:'Sign in',       pcm:'Sign in',        yo:'Wọlé',           ha:'Shiga',         ig:'Banye' },
    'btn.signout':    { en:'Out',           pcm:'Comot',          yo:'Jáde',           ha:'Fita',          ig:'Pụọ' },
    'btn.cancel':     { en:'Cancel',        pcm:'Cancel',         yo:'Fagilé',         ha:'Soke',          ig:'Kagbuo' },
    'btn.close':      { en:'Close',         pcm:'Close',          yo:'Tì',             ha:'Rufe',          ig:'Mechie' },
    'word.talk':      { en:'Talk',          pcm:'Talk',           yo:'Ìfọ̀rọ̀wérọ̀',    ha:'Zance',         ig:'Mkparịta' },
    'word.talks':     { en:'Talks',         pcm:'Talks',          yo:'Àwọn Ìfọ̀rọ̀wérọ̀',ha:'Zantuka',      ig:'Mkparịta' },
    'word.reply':     { en:'reply',         pcm:'reply',          yo:'èsì',            ha:'amsa',          ig:'azịza' },
    'word.replies':   { en:'replies',       pcm:'replies',        yo:'àwọn èsì',       ha:'amsoshi',       ig:'azịza' },

    /* ---- home & sections ---- */
    'home.title':     { en:'The Board',     pcm:'The Board',      yo:'Pátákó náà',     ha:'Allon',         ig:'Bọọdụ' },
    'home.sub':       { en:"Pick a section, or see what's busy right now",
                        pcm:'Pick section, abi see wetin dey hot now',
                        yo:'Yan apá kan, tàbí wo ohun tó ń lọ lọ́wọ́',
                        ha:'Zaɓi sashe, ko ka ga abin da ke faruwa yanzu',
                        ig:'Họrọ akụkụ, ma ọ bụ hụ ihe na-eme ugbu a' },
    'home.trending':  { en:'Trending now',  pcm:'Wetin dey hot',  yo:'Èyí tó gbajúmọ̀', ha:'Mai tashe yanzu', ig:'Na-ewu ewu' },
    'btn.newtalk':    { en:'New Talk',      pcm:'New Talk',       yo:'Ìfọ̀rọ̀wérọ̀ Tuntun', ha:'Sabon Zance', ig:'Mkparịta Ọhụrụ' },
    'btn.starttalk':  { en:'Start a Talk',  pcm:'Start Talk',     yo:'Bẹ̀rẹ̀ Ìfọ̀rọ̀wérọ̀', ha:'Fara Zance', ig:'Malite Mkparịta' },

    /* ---- composing ---- */
    'compose.title':  { en:'Title',         pcm:'Title',          yo:'Àkòrí',          ha:'Take',          ig:'Isiokwu' },
    'compose.message':{ en:'Your message',  pcm:'Your message',   yo:'Ọ̀rọ̀ rẹ',        ha:'Saƙonka',       ig:'Ozi gị' },
    'compose.section':{ en:'Section',       pcm:'Section',        yo:'Apá',            ha:'Sashe',         ig:'Akụkụ' },
    'compose.photos': { en:'Photos',        pcm:'Photos',         yo:'Àwòrán',         ha:'Hotuna',        ig:'Foto' },
    'btn.posttalk':   { en:'Post Talk',     pcm:'Post Talk',      yo:'Fi Ìfọ̀rọ̀wérọ̀ sí', ha:'Aika Zance', ig:'Zipu Mkparịta' },
    'btn.postreply':  { en:'Post Reply',    pcm:'Post Reply',     yo:'Fi Èsì sí',      ha:'Aika Amsa',     ig:'Zipu Azịza' },
    'btn.addphotos':  { en:'Add photos',    pcm:'Add photos',     yo:'Fi àwòrán kún',  ha:'Ƙara hotuna',   ig:'Tinye foto' },

    /* ---- auth ---- */
    'auth.createacct':{ en:'Create your account', pcm:'Create your account',
                        yo:'Ṣẹ̀dá àkántì rẹ', ha:'Ƙirƙiri asusunka', ig:'Mepụta akaụntụ gị' },
    'auth.welcome':   { en:'Welcome back',  pcm:'Welcome back',   yo:'Káàbọ̀ padà',    ha:'Barka da dawowa', ig:'Nnọọ ọzọ' },
    'auth.dname':     { en:'Display name',  pcm:'Display name',   yo:'Orúkọ ìfihàn',   ha:'Sunan nuni',    ig:'Aha ngosi' },
    'auth.password':  { en:'Password',      pcm:'Password',       yo:'Ọ̀rọ̀ aṣínà',     ha:'Kalmar sirri',  ig:'Okwuntughe' },
    'auth.email':     { en:'Email',         pcm:'Email',          yo:'Ímeèlì',         ha:'Imel',          ig:'Ozi-e' },
    'auth.city':      { en:'Your city / area', pcm:'Your city / area',
                        yo:'Ìlú / agbègbè rẹ', ha:'Birninka / yankinka', ig:'Obodo / mpaghara gị' },

    /* ---- notifications & account ---- */
    'notif.title':    { en:'Notifications', pcm:'Notifications',  yo:'Ìfitọ́nilétí',    ha:'Sanarwa',       ig:'Ọkwa' },
    'notif.markread': { en:'Mark all read', pcm:'Mark all as read', yo:'Sàmì sí gbogbo rẹ̀', ha:'Yi alama duka', ig:'Kaa ha niile' },
    'notif.none':     { en:'No notifications yet.', pcm:'No notification yet.',
                        yo:'Kò sí ìfitọ́nilétí síbẹ̀.', ha:'Babu sanarwa tukuna.', ig:'Enwebeghị ọkwa.' },
    'acct.title':     { en:'My Account',    pcm:'My Account',     yo:'Àkántì Mi',      ha:'Asusuna',       ig:'Akaụntụ M' },
    'acct.membersince':{ en:'Member since', pcm:'Member since',   yo:'Ọmọ ẹgbẹ́ láti',  ha:'Memba tun',     ig:'Onye otu kemgbe' },

    /* ---- moderation ---- */
    'mod.title':      { en:'Moderation',    pcm:'Moderation',     yo:'Ìṣàkóso',        ha:'Tsari',         ig:'Nlekọta' },
    'mod.report':     { en:'Report',        pcm:'Report',         yo:'Ròyìn',          ha:'Kai rahoto',    ig:'Kọọ' },

    /* ---- sorting ---- */
    'sort.newest':    { en:'Newest',        pcm:'Newest',         yo:'Tuntun jù',      ha:'Sabo',          ig:'Ọhụrụ' },
    'sort.top':       { en:'Top voted',     pcm:'Top voted',      yo:'Èyí tó ga jù',   ha:'Mafi yawan kuri’a', ig:'Kachasị votu' },
    'sort.replies':   { en:'Most replies',  pcm:'Most replies',   yo:'Èsì púpọ̀ jù',    ha:'Mafi amsoshi',  ig:'Azịza kachasị' },
  },
};
