import { Resend } from 'resend'
import type { Locale } from '@/lib/i18n/config'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

const SUBJECT: Record<Locale, string> = {
  en: 'Your Aqd verification code',
  ar: 'رمز التحقق الخاص بك في عقد',
}

const BODY: Record<Locale, (code: string) => string> = {
  en: (code) =>
    `<p>Your verification code is:</p><p style="font-size:28px;letter-spacing:.2em;font-weight:700">${code}</p><p>It expires in 10 minutes. If you didn't request it, ignore this email.</p>`,
  ar: (code) =>
    `<div dir="rtl"><p>رمز التحقق الخاص بك:</p><p style="font-size:28px;letter-spacing:.2em;font-weight:700">${code}</p><p>تنتهي صلاحيته خلال ١٠ دقائق. إن لم تطلبه، تجاهل هذه الرسالة.</p></div>`,
}

/** Returns false rather than throwing: a send failure must not strand the user. */
export async function sendCodeEmail(to: string, code: string, locale: Locale): Promise<boolean> {
  if (!resend) {
    if (process.env.NODE_ENV !== 'production') console.info(`[dev] code for ${to}: ${code}`)
    return process.env.NODE_ENV !== 'production'
  }
  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject: SUBJECT[locale],
      html: BODY[locale](code),
    })
    return true
  } catch {
    return false
  }
}
