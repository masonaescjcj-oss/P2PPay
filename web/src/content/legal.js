// Terms of use, privacy notice and help (FAQ), in Dari and English.
// DRAFT: these texts must be reviewed by a lawyer familiar with Afghan law and AML/KYC rules before the
// public launch (RELEASE.md). Numbers (fees, limits) come from the server config so they never drift.
// When the terms or privacy texts change, bump TERMS_VERSION on the server: users accept again.

const pct = (bps) => `${(Number(bps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`

export function terms(cfg, lang) {
  const fee = pct(cfg?.tradeFeeBps ?? 10)
  const wfee = cfg?.withdrawFee ?? '1'
  const minW = cfg?.minWithdraw ?? '5'
  if (lang === 'en') {
    return [
      { h: 'What P2PPay is', p: ['P2PPay is a marketplace where people buy and sell Tether (USDT, TRC20) with each other for Afghani (AFN). P2PPay is not a bank and does not buy or sell USDT itself. It holds the seller’s USDT in escrow during a trade and releases it only when the seller confirms that the AFN payment arrived, or when support decides a dispute.'] },
      { h: 'Who may use it', list: ['You must be at least 18 years old and able to enter into a binding agreement.', 'One account per person. Your account, phone number and documents must be your own.', 'Use is not allowed where it is prohibited by law or for anyone subject to sanctions.'] },
      { h: 'Your account and security', list: ['Keep your password, verification codes, authenticator app and backup codes secret. P2PPay staff will never ask for them.', 'You are responsible for everything done with your account. Tell support at once if you think someone else has access.', 'Turn on two-step verification. Withdrawals always need a fresh security code.'] },
      { h: 'Trading and escrow', list: ['When a trade opens, the USDT is locked in escrow. The buyer pays the seller directly, only to the account shown in the trade, and then taps “I have paid”.', 'The seller releases the USDT only after checking that the full amount arrived in their own account. A release cannot be undone.', 'Pay only from an account in your own name. Third-party payments are not allowed.', 'Unpaid trades are cancelled automatically when the payment time ends. Never pay after a trade is cancelled.', 'Keep all communication about a trade in the trade chat, and never trade outside the platform.'] },
      { h: 'Fees', list: [`Trade fee: ${fee} of the USDT amount, deducted from what the buyer receives.`, `Withdrawal: a network fee of ${wfee} USDT; the minimum withdrawal is ${minW} USDT.`, 'Deposits are free. Only USDT on the TRON (TRC20) network is supported; other networks or tokens sent to your address can be lost.'] },
      { h: 'Disputes', p: ['If something goes wrong, open a dispute in the trade. Support reviews the chat and the evidence both sides provide (payment receipts, account statements) and either releases the USDT to the buyer or returns it to the seller. Support’s decision is final for the escrowed USDT. Deliberately false disputes lead to account restrictions.'] },
      { h: 'Verification and limits', p: ['Daily trade and withdrawal limits depend on your verification level (phone number, identity document, enhanced review). We may ask for more information at any time to meet legal duties, and may limit an account until it is provided.'] },
      { h: 'Not allowed', list: ['Fraud, fake receipts, chargebacks or payment reversals.', 'Money laundering, terrorist financing, or funds from crime or sanctioned sources.', 'Using someone else’s account, documents or payment accounts.', 'Harassing other users or support staff.'] },
      { h: 'Suspension and closure', p: ['We may pause trading, hold funds under review, or close an account to follow the law, to protect users, or when these terms are broken. Where the law allows, we will tell you why and return funds that are not in dispute.'] },
      { h: 'Risks', list: ['The price of USDT against AFN can change. USDT is issued by a third party, and its value depends on that issuer.', 'Blockchain transfers cannot be reversed. Check every address before you withdraw.', 'Service can be interrupted by network problems, maintenance or events outside our control.'] },
      { h: 'Liability', p: ['We work to keep the service safe and available but provide it “as is”. As far as the law allows, P2PPay is not responsible for losses caused by other users’ actions outside the escrow, by payments made outside the trade instructions, or by events outside our control.'] },
      { h: 'Changes', p: ['We may update these terms. When we do, the app asks you to read and accept the new version before you continue trading.'] },
      { h: 'Contact', p: ['Questions about these terms: use Support in the app.'] },
    ]
  }
  return [
    { h: 'P2PPay چیست', p: ['P2PPay بازاری است که در آن مردم تتر (USDT شبکهٔ TRC20) را با افغانی از یکدیگر می‌خرند و به یکدیگر می‌فروشند. P2PPay بانک نیست و خودش تتر نمی‌خرد یا نمی‌فروشد. در طول معامله، تتر فروشنده را به امانت نگه می‌دارد و فقط وقتی آزاد می‌کند که فروشنده رسیدن پول افغانی را تأیید کند، یا پشتیبانی در داوری تصمیم بگیرد.'] },
    { h: 'چه کسانی می‌توانند استفاده کنند', list: ['حداقل ۱۸ سال سن داشته باشید و بتوانید قرارداد الزام‌آور ببندید.', 'هر نفر فقط یک حساب. حساب، شمارهٔ موبایل و مدارک باید متعلق به خودتان باشد.', 'استفاده در جایی که قانون منع کرده، یا برای افراد تحت تحریم، مجاز نیست.'] },
    { h: 'حساب و امنیت شما', list: ['رمز عبور، کدهای تأیید، اپ احراز هویت و کدهای پشتیبان را به هیچ‌کس ندهید. کارکنان P2PPay هرگز این‌ها را از شما نمی‌خواهند.', 'مسئولیت همهٔ کارهایی که با حساب شما انجام می‌شود با شماست. اگر فکر می‌کنید کس دیگری به حسابتان دسترسی دارد، فوراً به پشتیبانی خبر دهید.', 'تأیید دومرحله‌ای را روشن کنید. هر برداشت همیشه به کد امنیتی تازه نیاز دارد.'] },
    { h: 'معامله و امانت', list: ['با باز شدن معامله، تتر به امانت قفل می‌شود. خریدار مستقیم به فروشنده، و فقط به حسابی که در معامله نشان داده شده، پول می‌فرستد و سپس «پرداخت کردم» را می‌زند.', 'فروشنده فقط پس از اطمینان از رسیدن کامل پول به حساب خودش تتر را آزاد می‌کند. آزادسازی برگشت‌پذیر نیست.', 'فقط از حسابی به نام خودتان پرداخت کنید. پرداخت از حساب شخص دیگر مجاز نیست.', 'معاملهٔ پرداخت‌نشده با تمام شدن زمان پرداخت خودکار لغو می‌شود. بعد از لغو معامله هرگز پول نفرستید.', 'همهٔ گفتگوهای مربوط به معامله را در گفتگوی همان معامله انجام دهید و هرگز بیرون از پلتفرم معامله نکنید.'] },
    { h: 'کارمزدها', list: [`کارمزد معامله: ${fee} از مقدار تتر، که از تتر دریافتی خریدار کم می‌شود.`, `برداشت: کارمزد شبکه ${wfee} تتر؛ حداقل برداشت ${minW} تتر.`, 'واریز رایگان است. فقط تتر روی شبکهٔ ترون (TRC20) پشتیبانی می‌شود؛ شبکه یا توکن دیگری که به آدرس شما فرستاده شود ممکن است از دست برود.'] },
    { h: 'داوری', p: ['اگر مشکلی پیش آمد، در همان معامله شکایت باز کنید. پشتیبانی گفتگو و مدارک هر دو طرف (رسید پرداخت، صورت‌حساب) را بررسی می‌کند و تتر را یا به خریدار آزاد می‌کند یا به فروشنده برمی‌گرداند. تصمیم پشتیبانی دربارهٔ تتر امانی نهایی است. شکایت عمدی و دروغ به محدود شدن حساب منجر می‌شود.'] },
    { h: 'احراز هویت و سقف‌ها', p: ['سقف روزانهٔ معامله و برداشت به سطح احراز هویت شما (شمارهٔ موبایل، مدرک هویت، بررسی ویژه) بستگی دارد. برای انجام وظایف قانونی ممکن است هر زمان اطلاعات بیشتری بخواهیم و تا دریافت آن، حساب را محدود کنیم.'] },
    { h: 'کارهای ممنوع', list: ['کلاهبرداری، رسید جعلی، برگشت زدن یا لغو پرداخت پس از دریافت تتر.', 'پول‌شویی، تأمین مالی تروریسم، یا پول حاصل از جرم یا از منابع تحت تحریم.', 'استفاده از حساب، مدارک یا حساب بانکی شخص دیگر.', 'آزار دادن کاربران دیگر یا کارکنان پشتیبانی.'] },
    { h: 'تعلیق و بستن حساب', p: ['ممکن است برای رعایت قانون، حفاظت از کاربران، یا در صورت نقض این قوانین، معامله را متوقف کنیم، موجودی را تا پایان بررسی نگه داریم یا حساب را ببندیم. تا جایی که قانون اجازه دهد، دلیل را به شما می‌گوییم و موجودی بدون اختلاف را برمی‌گردانیم.'] },
    { h: 'ریسک‌ها', list: ['قیمت تتر در برابر افغانی می‌تواند تغییر کند. تتر را شرکت دیگری منتشر می‌کند و ارزش آن به آن ناشر بستگی دارد.', 'انتقال روی بلاک‌چین برگشت‌پذیر نیست. پیش از برداشت هر آدرس را دوباره بررسی کنید.', 'خدمات ممکن است به دلیل مشکلات شبکه، نگهداری یا رویدادهای خارج از کنترل ما قطع شود.'] },
    { h: 'مسئولیت', p: ['ما برای امن و در دسترس نگه داشتن خدمات تلاش می‌کنیم، اما آن را «همان‌طور که هست» ارائه می‌دهیم. تا جایی که قانون اجازه می‌دهد، P2PPay مسئول زیان ناشی از کارهای کاربران دیگر بیرون از امانت، پرداخت‌های خلاف راهنمای معامله، یا رویدادهای خارج از کنترل ما نیست.'] },
    { h: 'تغییرات', p: ['ممکن است این قوانین را به‌روز کنیم. در آن صورت، اپ پیش از ادامهٔ معامله از شما می‌خواهد نسخهٔ جدید را بخوانید و بپذیرید.'] },
    { h: 'تماس', p: ['برای پرسش دربارهٔ این قوانین از بخش «پشتیبانی» در اپ استفاده کنید.'] },
  ]
}

export function privacy(cfg, lang) {
  if (lang === 'en') {
    return [
      { h: 'What we collect', list: ['Account: username, display name, password (stored only as a salted hash).', 'Phone number, to verify you and send security codes.', 'Identity documents and selfie, when you apply for a higher verification level. They are encrypted (AES-256-GCM) before they are stored and only verification staff can view them.', 'Trades, chat messages, payment accounts you add, deposits and withdrawals, including blockchain addresses and transaction IDs.', 'Security records: sign-ins, IP address and browser, failed attempts. Error reports from the app when a page fails, and feedback you send.'] },
      { h: 'Why', list: ['To run trades and the escrow, and to show the other party the payment account you chose.', 'To protect accounts (two-step verification, lockout, suspicious-activity checks) and resolve disputes.', 'To meet legal duties such as identity checks and anti-money-laundering rules.', 'To fix problems and improve the app.'] },
      { h: 'Who can see it', list: ['The other party in a trade sees your display name, trade statistics and, if you are the seller, the payment account for that trade.', 'Support and verification staff see what they need for their role; every staff decision is recorded.', 'Service providers that run parts of the service for us: database and file hosting, SMS delivery.', 'Authorities, only when the law requires it.', 'We do not sell your data and we do not use advertising trackers.'] },
      { h: 'Cookies', p: ['We use one cookie: your sign-in session. It is not used for tracking or advertising.'] },
      { h: 'How long we keep it', p: ['We keep account, trade and identity records for as long as the law requires after an account closes (the exact period will be confirmed by legal review), then delete them. Chat messages and error reports are deleted sooner when they are no longer needed.'] },
      { h: 'Your choices', list: ['See and change your profile and security settings in the app.', 'Ask support for a copy of your data, a correction, or closure of your account.', 'Blockchain transactions are public and cannot be deleted by anyone.'] },
      { h: 'Contact', p: ['Privacy questions: use Support in the app.'] },
    ]
  }
  return [
    { h: 'چه اطلاعاتی جمع می‌کنیم', list: ['حساب: نام کاربری، نام نمایشی، رمز عبور (فقط به‌صورت هش نمک‌دار نگهداری می‌شود).', 'شمارهٔ موبایل، برای تأیید هویت و فرستادن کدهای امنیتی.', 'مدرک هویت و سلفی، وقتی برای سطح بالاتر درخواست می‌دهید. این فایل‌ها پیش از ذخیره رمزگذاری می‌شوند (AES-256-GCM) و فقط کارشناس احراز هویت آن‌ها را می‌بیند.', 'معاملات، پیام‌های گفتگو، حساب‌های دریافت پول، واریزها و برداشت‌ها، از جمله آدرس‌های بلاک‌چین و شناسهٔ تراکنش.', 'سوابق امنیتی: ورودها، آدرس IP و مرورگر، تلاش‌های ناموفق. گزارش خطا هنگام خراب شدن صفحه، و بازخوردهایی که می‌فرستید.'] },
    { h: 'برای چه', list: ['برای انجام معامله و امانت، و نشان دادن حساب دریافت پول انتخاب‌شده به طرف معامله.', 'برای حفاظت از حساب‌ها (تأیید دومرحله‌ای، قفل حساب، بررسی فعالیت مشکوک) و رسیدگی به شکایت‌ها.', 'برای انجام وظایف قانونی مانند احراز هویت و مقررات مبارزه با پول‌شویی.', 'برای رفع اشکال و بهتر کردن اپ.'] },
    { h: 'چه کسی آن را می‌بیند', list: ['طرف معامله نام نمایشی و آمار معاملات شما را می‌بیند و اگر فروشنده باشید، حساب دریافت پول همان معامله را.', 'کارکنان پشتیبانی و احراز هویت فقط آنچه برای کارشان لازم است را می‌بینند؛ هر تصمیم کارکنان ثبت می‌شود.', 'ارائه‌دهندگانی که بخشی از خدمات را برای ما اجرا می‌کنند: میزبانی پایگاه‌داده و فایل، ارسال پیامک.', 'مقامات، فقط وقتی قانون الزام کند.', 'ما اطلاعات شما را نمی‌فروشیم و از ردیاب تبلیغاتی استفاده نمی‌کنیم.'] },
    { h: 'کوکی‌ها', p: ['فقط یک کوکی داریم: نشست ورود شما. از آن برای ردیابی یا تبلیغات استفاده نمی‌شود.'] },
    { h: 'مدت نگهداری', p: ['سوابق حساب، معاملات و احراز هویت را پس از بسته شدن حساب تا مدتی که قانون الزام می‌کند نگه می‌داریم (مدت دقیق در بازبینی حقوقی تعیین می‌شود) و سپس پاک می‌کنیم. پیام‌های گفتگو و گزارش‌های خطا زودتر، وقتی دیگر لازم نباشند، پاک می‌شوند.'] },
    { h: 'اختیارات شما', list: ['پروفایل و تنظیمات امنیتی را در اپ ببینید و تغییر دهید.', 'از پشتیبانی نسخه‌ای از اطلاعات خود، اصلاح آن، یا بستن حساب را بخواهید.', 'تراکنش‌های بلاک‌چین عمومی‌اند و هیچ‌کس نمی‌تواند آن‌ها را پاک کند.'] },
    { h: 'تماس', p: ['برای پرسش‌های حریم خصوصی از بخش «پشتیبانی» در اپ استفاده کنید.'] },
  ]
}

export function faq(cfg, lang) {
  const fee = pct(cfg?.tradeFeeBps ?? 10)
  if (lang === 'en') {
    return [
      { q: 'How do I buy USDT?', a: 'Open Market → Buy, pick an offer whose price, limits and payment method suit you, enter the amount and open the trade. Send the AFN to the account shown in the trade, from an account in your own name, then tap “I have paid”. The seller releases the USDT to your wallet.' },
      { q: 'How do I sell USDT?', a: 'Deposit USDT (TRC20) to your wallet, add the account where you receive AFN under My payment accounts, then sell into a buy offer or post your own sell offer. Release the USDT only after you see the full amount in your own account — never because of a screenshot or a message.' },
      { q: 'What is escrow?', a: 'While a trade is open, the seller’s USDT is locked by P2PPay. Neither side can take it until the seller releases it or support decides a dispute. That is what protects the buyer.' },
      { q: 'What are the fees?', a: `The trade fee is ${fee}, taken from the USDT the buyer receives. Withdrawals have a network fee shown on the withdraw page. Deposits are free.` },
      { q: 'Which network do I use for deposits?', a: 'Only USDT on TRON (TRC20). Sending another token or another network to your address can lose the funds.' },
      { q: 'The seller is not releasing. What do I do?', a: 'Write in the trade chat first. If there is no answer, open a dispute from the trade page and add your payment receipt. Support will review it.' },
      { q: 'Why do I need to verify my phone and ID?', a: 'Verification protects accounts and is required by law for larger amounts. Each level raises your daily trade and withdrawal limits.' },
      { q: 'How do I stay safe?', a: 'Never trade or pay outside the platform. Never share your password, codes or backup codes — staff will never ask for them. Pay only the account shown in the trade. As a seller, check your own bank or wallet app before releasing.' },
      { q: 'Can I install the app on my phone?', a: 'Yes. Open Profile → Install on phone. On iPhone use Share → Add to Home Screen in Safari.' },
    ]
  }
  return [
    { q: 'چطور تتر بخرم؟', a: 'از «بازار» بخش خرید را باز کنید، آگهی‌ای را که قیمت، محدوده و روش پرداختش مناسب شماست انتخاب کنید، مقدار را بنویسید و معامله را باز کنید. پول افغانی را از حسابی به نام خودتان به حسابی که در معامله نشان داده شده بفرستید و «پرداخت کردم» را بزنید. فروشنده تتر را به کیف پول شما آزاد می‌کند.' },
    { q: 'چطور تتر بفروشم؟', a: 'تتر (TRC20) را به کیف پول خود واریز کنید، حساب دریافت افغانی را در «حساب‌های من» ثبت کنید، سپس به یک آگهی خرید بفروشید یا آگهی فروش خودتان را بسازید. تتر را فقط وقتی آزاد کنید که مبلغ کامل را در حساب خودتان دیدید — نه با عکس رسید یا پیام.' },
    { q: 'امانت (escrow) یعنی چه؟', a: 'تا وقتی معامله باز است، تتر فروشنده نزد P2PPay قفل می‌ماند. هیچ‌کدام از دو طرف نمی‌توانند آن را بردارند، مگر اینکه فروشنده آزاد کند یا پشتیبانی در داوری تصمیم بگیرد. همین از خریدار محافظت می‌کند.' },
    { q: 'کارمزدها چقدر است؟', a: `کارمزد معامله ${fee} است که از تتر دریافتی خریدار کم می‌شود. برداشت کارمزد شبکه دارد که در صفحهٔ برداشت نشان داده می‌شود. واریز رایگان است.` },
    { q: 'برای واریز از چه شبکه‌ای استفاده کنم؟', a: 'فقط تتر روی شبکهٔ ترون (TRC20). فرستادن توکن یا شبکهٔ دیگر به آدرس شما ممکن است باعث از دست رفتن پول شود.' },
    { q: 'فروشنده تتر را آزاد نمی‌کند. چه کنم؟', a: 'اول در گفتگوی معامله پیام بدهید. اگر جواب نداد، از صفحهٔ معامله شکایت باز کنید و رسید پرداخت را بفرستید. پشتیبانی بررسی می‌کند.' },
    { q: 'چرا باید موبایل و مدرک هویت را تأیید کنم؟', a: 'تأیید هویت از حساب‌ها محافظت می‌کند و برای مبالغ بالاتر الزام قانونی است. هر سطح، سقف روزانهٔ معامله و برداشت شما را بالا می‌برد.' },
    { q: 'چطور امن بمانم؟', a: 'هرگز بیرون از پلتفرم معامله یا پرداخت نکنید. رمز، کدها یا کدهای پشتیبان را به کسی ندهید — کارکنان هرگز آن‌ها را نمی‌خواهند. فقط به حسابی که در معامله نشان داده شده پرداخت کنید. اگر فروشنده‌اید، پیش از آزادسازی برنامهٔ بانک یا کیف پول خودتان را ببینید.' },
    { q: 'می‌توانم اپ را روی گوشی نصب کنم؟', a: 'بله. از «حساب من» گزینهٔ «نصب روی گوشی» را بزنید. در آیفون، در Safari از دکمهٔ اشتراک‌گذاری «Add to Home Screen» را انتخاب کنید.' },
  ]
}
