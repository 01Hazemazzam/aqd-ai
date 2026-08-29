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
    // The SDK does NOT throw on an API-level failure (bad domain, rate
    // limit, an invalid recipient) -- it resolves normally with
    // `{ data: null, error }`. Confirmed live: a real send to a sandbox-
    // restricted recipient resolved successfully by await's standards while
    // silently carrying a validation_error, and the old code -- checking
    // only for a throw -- reported it as sent. `error` must be checked
    // explicitly; the try/catch stays for genuine network-level throws.
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject: SUBJECT[locale],
      html: BODY[locale](code),
    })
    if (error) {
      console.error('[sendCodeEmail] Resend rejected the send:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[sendCodeEmail] Resend send failed:', err instanceof Error ? err.message : err)
    return false
  }
}

const INVITE_SUBJECT: Record<Locale, (orgName: string) => string> = {
  en: (orgName) => `You've been invited to join ${orgName} on Aqd`,
  ar: (orgName) => `تمت دعوتك للانضمام إلى ${orgName} على عقد`,
}

const INVITE_BODY: Record<Locale, (orgName: string, url: string) => string> = {
  en: (orgName, url) =>
    `<p>You've been invited to join <strong>${orgName}</strong> on Aqd.</p><p><a href="${url}">Accept the invitation</a></p><p>This link expires in 7 days.</p>`,
  ar: (orgName, url) =>
    `<div dir="rtl"><p>تمت دعوتك للانضمام إلى <strong>${orgName}</strong> على عقد.</p><p><a href="${url}">قبول الدعوة</a></p><p>تنتهي صلاحية هذا الرابط خلال ٧ أيام.</p></div>`,
}

/** Returns false rather than throwing: a send failure must not strand the inviter. */
export async function sendInviteEmail(to: string, orgName: string, url: string, locale: Locale): Promise<boolean> {
  if (!resend) {
    if (process.env.NODE_ENV !== 'production') console.info(`[dev] invite for ${to}: ${url}`)
    return process.env.NODE_ENV !== 'production'
  }
  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject: INVITE_SUBJECT[locale](orgName),
      html: INVITE_BODY[locale](orgName, url),
    })
    if (error) {
      console.error('[sendInviteEmail] Resend rejected the send:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[sendInviteEmail] Resend send failed:', err instanceof Error ? err.message : err)
    return false
  }
}
