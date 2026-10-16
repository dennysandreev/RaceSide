import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const templatesDir = resolve(root, "supabase/templates/auth");
const previewDir = resolve(root, "output/auth-emails");
const site = "https://raceside.online";
// Public, immutable PNG; SVG is not supported by several major email clients.
const logo = "https://ngspcljebeqdcvjycutq.supabase.co/storage/v1/object/public/driver-avatars/brand/raceside-email-signature-v1.png";

export const emails = [
  {
    id: "confirmation", label: "Подтверждение почты",
    subject: "Подтвердите почту для RaceSide", title: "Добро пожаловать<br>в RaceSide",
    preheader: "Один шаг, и вы в RaceSide. Подтвердите свою почту.",
    body: "Подтвердите почту, чтобы сохранять любимые команды и пилотов, делать прогнозы и следить за сезоном вместе с нами.",
    action: "Подтвердить почту", href: "{{ .ConfirmationURL }}", link: true,
    note: "Откройте ссылку в том же браузере, в котором регистрировались. Ссылка одноразовая.",
    safety: "Если вы не регистрировались в RaceSide, просто пропустите это письмо.",
  },
  {
    id: "recovery", label: "Восстановление пароля",
    subject: "Восстановление пароля в RaceSide", title: "Вернём вас<br>в RaceSide",
    preheader: "Задайте новый пароль и вернитесь к сезону.",
    body: "Забыли пароль? Нажмите на кнопку ниже, чтобы задать новый и снова войти в свой аккаунт.",
    action: "Задать новый пароль", href: "{{ .ConfirmationURL }}", link: true,
    note: "Откройте ссылку в том же браузере, в котором запросили сброс пароля. Ссылка одноразовая.",
    safety: "Если вы не просили сбросить пароль, просто пропустите это письмо. Ваш пароль останется прежним.",
  },
  {
    id: "magic_link", label: "Вход по ссылке",
    subject: "Ваша ссылка для входа в RaceSide", title: "Вы снова<br>в RaceSide",
    preheader: "Войдите в аккаунт по одноразовой ссылке.",
    body: "Ваша ссылка для входа готова. Нажмите на кнопку, чтобы открыть RaceSide и продолжить следить за сезоном.",
    action: "Войти в RaceSide", href: "{{ .ConfirmationURL }}", link: true,
    note: "Откройте ссылку в том же браузере, в котором запросили вход. Ссылка одноразовая, не пересылайте её.",
    safety: "Если вы не запрашивали вход, просто пропустите это письмо.",
  },
  {
    id: "invite", label: "Приглашение",
    subject: "Вас пригласили в RaceSide", title: "Увидимся<br>в RaceSide",
    preheader: "Примите приглашение и присоединяйтесь к RaceSide.",
    body: "Вас пригласили в RaceSide. Присоединяйтесь, чтобы следить за Формулой-1, выбирать фаворитов и делать прогнозы на гонки.",
    action: "Принять приглашение", href: "{{ .ConfirmationURL }}", link: true,
    note: "Ссылка одноразовая. Не пересылайте её другим людям.",
    safety: "Если вы не ждали приглашения, просто пропустите это письмо.",
  },
  {
    id: "email_change", label: "Подтверждение новой почты",
    subject: "Подтвердите смену почты в RaceSide", title: "Новая почта.<br>Ваш RaceSide.",
    preheader: "Подтвердите новый адрес для вашего аккаунта.",
    body: "Вы запросили смену почты в RaceSide. Подтвердите новый адрес:",
    detail: "{{ .NewEmail }}", action: "Подтвердить смену почты", href: "{{ .ConfirmationURL }}", link: true,
    note: "Для завершения смены может потребоваться подтверждение и со старого, и с нового адреса.",
    safety: "Если вы не меняли почту, не нажимайте на кнопку и свяжитесь с нами.",
  },
  {
    id: "reauthentication", label: "Код подтверждения",
    subject: "Код подтверждения RaceSide", title: "Подтвердите,<br>что это вы",
    preheader: "Ваш одноразовый код для подтверждения действия.",
    body: "Введите этот код в RaceSide, чтобы подтвердить действие в своём аккаунте.",
    code: true, note: "Код одноразовый. Никому его не сообщайте, даже если вас об этом просят.",
    safety: "Если вы ничего не подтверждали, просто пропустите это письмо.",
  },
  {
    id: "password_changed_notification", label: "Пароль изменён",
    subject: "Ваш пароль в RaceSide изменён", title: "Новый пароль.<br>Всё готово.",
    preheader: "Пароль вашего аккаунта изменён. Проверьте, что это сделали вы.",
    body: "Пароль вашего аккаунта RaceSide изменён. Если это сделали вы, больше ничего делать не нужно.",
    action: "Открыть RaceSide", href: site,
    safety: `Если это были не вы, <a href="${site}/auth/forgot-password" style="color:#B80500;text-decoration:underline">сбросьте пароль</a> и <a href="${site}/feedback" style="color:#B80500;text-decoration:underline">свяжитесь с нами</a>.`,
  },
  {
    id: "email_changed_notification", label: "Почта изменена",
    subject: "Почта вашего аккаунта RaceSide изменена", title: "Ваша почта<br>обновлена",
    preheader: "Адрес аккаунта изменён. Проверьте, что это сделали вы.",
    body: "Почта вашего аккаунта RaceSide изменена. Теперь для входа используйте новый адрес:",
    detail: "{{ .Email }}", previous: "{{ .OldEmail }}",
    action: "Открыть RaceSide", href: site,
    safety: `Если это были не вы, <a href="${site}/feedback" style="color:#B80500;text-decoration:underline">свяжитесь с нами</a>, чтобы восстановить доступ к аккаунту.`,
  },
];

export function renderEmail(email) {
  const button = email.action ? `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#E10600" style="border-radius:8px;text-align:center"><a href="${email.href}" style="display:inline-block;padding:17px 26px;border:1px solid #E10600;border-radius:8px;color:#FFFFFF;font-size:16px;line-height:20px;font-weight:700;text-decoration:none;mso-padding-alt:0;text-underline-color:#E10600"><!--[if mso]><i style="mso-font-width:130%;mso-text-raise:20pt" hidden>&emsp;</i><![endif]--><span style="mso-text-raise:10pt">${email.action}</span><!--[if mso]><i style="mso-font-width:130%" hidden>&emsp;&#8203;</i><![endif]--></a></td></tr></table>` : "";
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${email.subject}</title>
<style>body{margin:0;padding:0}table{border-collapse:collapse}a:focus-visible{outline:3px solid #E10600;outline-offset:4px}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}@media(max-width:620px){.outer{padding:20px 12px!important}.pad{padding-left:24px!important;padding-right:24px!important}.heading{font-size:30px!important;line-height:35px!important}}@media(prefers-color-scheme:dark){.canvas{background-color:#121212!important}.sheet,.content{background-color:#1E1E1E!important}.heading,.detail,.otp{color:#F5F5F5!important}.body,.note,.safety{color:#C2C2C2!important}.rule{border-color:#3B3B3B!important}.footer{color:#AEAEAE!important}.footer a,.fallback{color:#D2D2D2!important}.safety a{color:#FF8079!important}}</style></head>
<body class="canvas" style="background-color:#F0F0F0;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;color:#171717">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${email.preheader}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="canvas" bgcolor="#F0F0F0"><tr><td class="outer" align="center" style="padding:40px 16px">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" class="sheet" width="100%" cellspacing="0" cellpadding="0" bgcolor="#FFFFFF" style="max-width:600px;width:100%;border-radius:12px">
<tr><td class="pad" bgcolor="#0B0B0B" style="padding:28px 40px;border-radius:12px 12px 0 0"><a href="${site}" style="display:inline-block;text-decoration:none"><img src="${logo}" width="211" height="66" alt="RaceSide · Гоночный центр" style="display:block;width:211px;height:66px;border:0;color:#F5F5F5;font-size:20px;font-weight:700"></a></td></tr>
<tr><td class="content pad" style="padding:38px 40px 36px">
<h1 class="heading" style="margin:0 0 20px;font-size:36px;line-height:41px;letter-spacing:-1px;font-weight:700;color:#171717">${email.title}</h1>
<p class="body" style="margin:0 0 26px;font-size:16px;line-height:25px;color:#4B4B4B">${email.body}</p>
${email.detail ? `<p class="detail" style="margin:0 0 26px;font-size:18px;line-height:26px;font-weight:700;color:#171717;overflow-wrap:anywhere;word-break:break-all">${email.detail}</p>` : ""}
${email.previous ? `<p class="note" style="margin:0 0 26px;font-size:14px;line-height:22px;color:#5D5D5D;overflow-wrap:anywhere;word-break:break-all">Прежний адрес: ${email.previous}</p>` : ""}
${email.code ? `<p class="otp" style="margin:0 0 26px;padding:18px 0;font-family:'Courier New',monospace;font-size:36px;line-height:42px;font-weight:700;letter-spacing:6px;color:#171717">{{ .Token }}</p>` : button}
${email.note ? `<p class="note" style="margin:22px 0 0;font-size:14px;line-height:22px;color:#5D5D5D">${email.note}</p>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="rule" style="padding-top:30px;border-bottom:1px solid #E3E3E3"></td></tr></table>
<p class="safety" style="margin:24px 0 0;font-size:14px;line-height:22px;color:#5D5D5D">${email.safety}</p>
${email.link ? `<p class="note" style="margin:20px 0 6px;font-size:12px;line-height:19px;color:#5D5D5D">Если кнопка не открывается, скопируйте ссылку в браузер:</p><a class="fallback" href="{{ .ConfirmationURL }}" style="display:block;font-size:12px;line-height:19px;color:#5D5D5D;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere">{{ .ConfirmationURL }}</a>` : ""}
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
<table role="presentation" width="100%" style="max-width:600px"><tr><td class="footer" align="center" style="padding:24px 16px 0;font-size:12px;line-height:20px;color:#666666">RaceSide. Весь сезон рядом с вами.<br><a href="${site}" style="color:#555555;text-decoration:underline">raceside.online</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${site}/feedback" style="color:#555555;text-decoration:underline">Связаться с нами</a></td></tr></table>
</td></tr></table></body></html>
`;
}

export function renderPreview(email) {
  const values = {
    ConfirmationURL: "https://raceside.online/auth/callback?code=preview-only&amp;flow=signup&amp;next=%2Fonboarding",
    Email: "fan@example.com", NewEmail: "new.fan@example.com", OldEmail: "fan@example.com", Token: "847 291",
  };
  const html = renderEmail(email).replace(/\{\{ \.(\w+) \}\}/g, (_, key) => values[key]);
  const darkStyles = html.match(/@media\(prefers-color-scheme:dark\)\{(.*?)\}<\/style>/)[1]
    .replace(/(^|\})([^{}]+)\{/g, (_, end, selectors) => `${end}${selectors.split(",").map(selector => `html.preview-dark ${selector}`).join(",")}{`);
  return html.replace("</head>", `<style>${darkStyles}</style></head>`);
}

async function build() {
  await mkdir(templatesDir, { recursive: true });
  await mkdir(previewDir, { recursive: true });
  const pngPath = resolve(root, "public/brand/raceside/email-signature.png");
  await sharp(resolve(root, "public/brand/raceside/raceside-signature-dark.svg"))
    .resize(844, 264).flatten({ background: "#0B0B0B" }).png().toFile(pngPath);
  const png = await readFile(pngPath);
  const previewLogo = `data:image/png;base64,${png.toString("base64")}`;
  const manifest = emails.map(({ id, label, subject }) => ({ id, label, subject, file: `${id}.html` }));
  await writeFile(resolve(templatesDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const email of emails) {
    await writeFile(resolve(templatesDir, `${email.id}.html`), renderEmail(email));
    await writeFile(resolve(previewDir, `${email.id}.html`), renderPreview(email).replace(logo, previewLogo));
  }
  await writeFile(resolve(previewDir, "index.html"), renderGallery(manifest));
  console.log(`Built ${emails.length} Supabase email templates and output/auth-emails/index.html`);
}

function renderGallery(manifest) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Письма RaceSide</title><style>*{box-sizing:border-box}body{margin:0;background:#101010;color:#f5f5f5;font-family:Arial,Helvetica,sans-serif}main{max-width:1500px;margin:0 auto;padding:32px}h1{margin:0 0 8px;font-size:30px;letter-spacing:-.7px}p{color:#b7b7b7;line-height:1.6}header{margin-bottom:24px}.tools{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}select,button{font:inherit;min-height:44px;border:1px solid #484848;background:#1e1e1e;color:#f5f5f5;border-radius:8px;padding:10px 16px}button{cursor:pointer}button[aria-pressed=true]{background:#e10600;border-color:#e10600}button:focus-visible,select:focus-visible{outline:3px solid #ff8079;outline-offset:3px}.subject{font-size:14px;margin-bottom:12px}.stage{display:flex;justify-content:center;background:#262626;padding:24px;border-radius:12px}iframe{border:0;width:760px;height:860px;background:#f0f0f0;color-scheme:light}.mobile iframe{width:375px}.dark iframe{color-scheme:dark}@media(max-width:700px){main{padding:20px 12px}.stage{padding:0}iframe{width:100%!important;height:950px}}</style></head><body><main><header><h1>Письма RaceSide</h1><p>Логотип, понятное действие и спокойный текст. Так письмо выглядит в почтовом клиенте.</p></header><div class="tools"><label for="template" style="align-self:center">Письмо</label><select id="template">${manifest.map(e => `<option value="${e.id}.html" data-subject="${e.subject}">${e.label}</option>`).join("")}</select><button id="mobile" aria-pressed="false">Мобильный вид</button><button id="dark" aria-pressed="false">Тёмная тема</button></div><p class="subject" id="subject">Тема: ${manifest[0].subject}</p><div class="stage" id="stage"><iframe id="email" title="Превью письма RaceSide" src="confirmation.html" sandbox="allow-same-origin"></iframe></div></main><script>const select=document.getElementById('template'),frame=document.getElementById('email'),stage=document.getElementById('stage');select.addEventListener('change',()=>{frame.src=select.value;document.getElementById('subject').textContent='Тема: '+select.selectedOptions[0].dataset.subject});for(const name of ['mobile','dark']){const button=document.getElementById(name);button.addEventListener('click',()=>{const active=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(active));stage.classList.toggle(name,active);updateTheme()})}function updateTheme(){frame.contentDocument?.documentElement.classList.toggle('preview-dark',stage.classList.contains('dark'))}frame.addEventListener('load',updateTheme)</script></body></html>`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
