import * as React from 'react';

export type EmailExtrasValue = {
  unsubscribeUrl?: string;
  /** Footer contact line — matches template sender when set */
  contactEmail?: string;
};

const EmailExtrasContext = React.createContext<EmailExtrasValue>({});

export function EmailExtrasProvider({
  value,
  children,
}: {
  value: EmailExtrasValue;
  children: React.ReactNode;
}) {
  return <EmailExtrasContext.Provider value={value}>{children}</EmailExtrasContext.Provider>;
}

export function useEmailExtras(): EmailExtrasValue {
  return React.useContext(EmailExtrasContext);
}
