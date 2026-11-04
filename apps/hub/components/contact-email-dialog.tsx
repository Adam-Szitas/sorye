'use client';
import { TranslatedText } from '@sorye/platform/react';


import {
  contactCopy,
  contactMailtoHref,
  contactMessageTemplate,
  contactProducts,
  contactSubjectDefault,
} from '@/lib/contact-copy';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';

function syncUserInvalid(event: SyntheticEvent<HTMLElement>) {
  const input = event.target;
  if (
    !(input instanceof HTMLInputElement) &&
    !(input instanceof HTMLTextAreaElement) &&
    !(input instanceof HTMLSelectElement)
  ) {
    return;
  }
  const invalid = input.matches(':user-invalid');
  if (invalid) {
    input.setAttribute('aria-invalid', 'true');
  } else {
    input.removeAttribute('aria-invalid');
  }
}

const FIELD_CLASS =
  'mt-1.5 w-full rounded-lg border border-white/12 bg-black/25 px-3 py-2.5 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]';

interface ContactEmailDialogProps {
  triggerClassName: string;
  triggerLabel: string;
}

export function ContactEmailDialog({
  triggerClassName,
  triggerLabel,
}: ContactEmailDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const dialogId = `${uid}-dialog`;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    dialogRef.current?.setAttribute('closedby', 'any');
  }, [mounted]);

  function openDialog() {
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function onBackdropClick(event: SyntheticEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) {
      event.currentTarget.close();
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const href = contactMailtoHref({
      name: String(data.get('name') ?? ''),
      fromEmail: String(data.get('fromEmail') ?? ''),
      company: String(data.get('company') ?? ''),
      subject: String(data.get('subject') ?? ''),
      product: String(data.get('product') ?? ''),
      message: String(data.get('message') ?? ''),
    });
    closeDialog();
    window.location.assign(href);
  }

  const dialog = (
      <dialog
        ref={dialogRef}
        id={dialogId}
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-white/10 bg-[var(--color-surface-raised)] p-0 text-[var(--color-text)] shadow-2xl backdrop:bg-black/70"
        aria-labelledby={`${uid}-title`}
        onClick={onBackdropClick}
        onBlur={syncUserInvalid}
        onInput={syncUserInvalid}
      >
        <form className="flex max-h-[min(40rem,calc(100dvh-2rem))] flex-col gap-4 overflow-auto p-6 sm:p-7" onSubmit={onSubmit} noValidate>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={`${uid}-title`} className="text-lg font-semibold tracking-tight">
                Email Sorye
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
                We pre-fill the address and subject. Add who you are and what
                you need, then Send.
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg px-2.5 py-1.5 text-sm text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              onClick={closeDialog}
            >
              <TranslatedText message="close" />
            </button>
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-to`}>
              To
            </label>
            <input
              id={`${uid}-to`}
              className={`${FIELD_CLASS} text-[var(--color-text-muted)]`}
              value={contactCopy.email}
              readOnly
              tabIndex={-1}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-subject`}>
              Subject
            </label>
            <input
              id={`${uid}-subject`}
              name="subject"
              className={FIELD_CLASS}
              defaultValue={contactSubjectDefault}
              required
              maxLength={160}
              aria-errormessage={`${uid}-subject-error`}
            />
            <p id={`${uid}-subject-error`} className="field-error mt-1 text-[11px] text-red-300">
              Add a subject.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-product`}>
              Product
            </label>
            <select
              id={`${uid}-product`}
              name="product"
              className={FIELD_CLASS}
              defaultValue={contactProducts[0]}
            >
              {contactProducts.map((product) => (
                <option key={product} value={product}>
                  {product}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-name`}>
              Your name
            </label>
            <input
              id={`${uid}-name`}
              name="name"
              className={FIELD_CLASS}
              autoComplete="name"
              required
              maxLength={120}
              aria-errormessage={`${uid}-name-error`}
            />
            <p id={`${uid}-name-error`} className="field-error mt-1 text-[11px] text-red-300">
              Name is required.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-email`}>
              Your email
            </label>
            <input
              id={`${uid}-email`}
              name="fromEmail"
              type="email"
              className={FIELD_CLASS}
              autoComplete="email"
              required
              maxLength={200}
              aria-errormessage={`${uid}-email-error`}
            />
            <p id={`${uid}-email-error`} className="field-error mt-1 text-[11px] text-red-300">
              Enter a valid email.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-company`}>
              Company
            </label>
            <input
              id={`${uid}-company`}
              name="company"
              className={FIELD_CLASS}
              autoComplete="organization"
              required
              maxLength={160}
              aria-errormessage={`${uid}-company-error`}
            />
            <p id={`${uid}-company-error`} className="field-error mt-1 text-[11px] text-red-300">
              Company is required.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-message`}>
              What you need
            </label>
            <textarea
              id={`${uid}-message`}
              name="message"
              className={`${FIELD_CLASS} min-h-28 resize-y`}
              required
              maxLength={2000}
              defaultValue={contactMessageTemplate}
              aria-errormessage={`${uid}-message-error`}
            />
            <p id={`${uid}-message-error`} className="field-error mt-1 text-[11px] text-red-300">
              Tell us what you need.
            </p>
          </div>

          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              className="rounded-xl px-4 py-2.5 text-sm text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              onClick={closeDialog}
            >
              <TranslatedText message="cancel" />
            </button>
            <button
              type="submit"
              className="rounded-xl bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-[var(--color-surface)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              Send
            </button>
          </div>
        </form>
      </dialog>
  );

  return (
    <>
      <button type="button" className={triggerClassName} onClick={openDialog}>
        {triggerLabel}
      </button>
      {mounted ? createPortal(dialog, document.body) : null}
    </>
  );
}
