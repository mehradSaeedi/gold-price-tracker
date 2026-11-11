// Shared provider identifiers and their user-facing labels.
const providerTradeLinks = {
      "Milli": "https://milli.gold/app/",
      "WallGold": "https://wallgold.ir/app/buy",
      "Talano": "https://talano.ir/",
      "Goldika": "https://goldika.ir/",
      "Talasea": "https://talasea.ir/",
      "Taline": "https://taline.ir/app",
      "MelliGold": "https://melligold.com/",
      "Ecogold": "https://ecogold.ir/",
      "Digikala": "https://www.digikala.com/wealth/",
      "Hamrahgold": "https://hamrahgold.com/",
      "TapsiGold": "https://tapsi.gold/",
      "Invi": "https://invi.ir/",
      "Myshemsh": "https://myshemsh.ir/",
      "Gerami": "https://gerami.com/gold/",
      "Snapp Sarmayeh": "https://app.snappsarmayeh.ir/",
      "Zarpin": "https://zarpin.com/",
      "Daric": "https://daric.gold/",
      "Zarafza": "https://zarafza.com/",
      "Zarpay": "https://zarpay24.com/trade-gold",
    };

const providerDisplayNames = {
      Milli: "میلی",
      WallGold: "وال‌گلد",
      Talano: "طلانو",
      Goldika: "گلدیکا",
      Talasea: "طلاسی",
      Taline: "طلاین",
      MelliGold: "ملی‌گلد",
      Ecogold: "اکوگلد",
      Digikala: "دیجی‌کالا",
      Hamrahgold: "همراه‌گلد",
      TapsiGold: "تپسی‌گلد",
      Invi: "اینوی",
      Myshemsh: "مای‌شمش",
      Gerami: "گرمی",
      "Snapp Sarmayeh": "اسنپ سرمایه",
      "Digi Gold": "دیجی‌گلد",
      Zarpin: "زرپین",
      Daric: "داریک",
      Zarafza: "زرافزا",
      Zarpay: "زرپی",
    };

const quoteSourceDisplayNames = {
      "Milli public API": "رابط عمومی میلی",
      "WallGold public API": "رابط عمومی وال‌گلد",
      "Talano public API": "رابط قیمت طلانو",
      "Goldika public API": "رابط عمومی گلدیکا",
      "Talasea public API": "رابط عمومی طلاسی",
      "Taline website": "وب‌سایت طلاین",
      "MelliGold public API": "رابط عمومی ملی‌گلد",
      "Ecogold public API": "رابط عمومی اکوگلد",
      "Digikala public API": "رابط عمومی دیجی‌کالا",
      "MelliGold API": "رابط ملی‌گلد",
      "TapsiGold public API": "رابط عمومی تپسی‌گلد",
      "Invi WebSocket": "داده زنده از ارتباط اینوی",
      "Myshemsh Socket.IO": "داده زنده از ارتباط مای‌شمش",
      "Gerami public API": "رابط عمومی گرمی",
      "Snapp Sarmayeh public API": "رابط عمومی اسنپ سرمایه",
      "Snapp Sarmayeh app API": "رابط اپلیکیشن اسنپ سرمایه",
      "Zarpin public API": "رابط عمومی زرپین",
      "Daric public API": "رابط عمومی داریک",
      "Zarafza public API": "رابط عمومی زرافزا",
      "Zarpay public API": "رابط عمومی زرپی",
      "HamrahGold WebSocket": "ارتباط زنده همراه‌گلد",
    };

export function displayProviderName(site) {
  return providerDisplayNames[site] || site || "نامشخص";
}

export function displayQuoteSource(source) {
  return quoteSourceDisplayNames[source] || source || "نامشخص";
}

export { providerTradeLinks, providerDisplayNames };
