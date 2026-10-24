import type { CSSProperties } from 'react';
import { Body, Column, Container, Head, Heading, Hr, Html, Preview, Row, Section, Text } from 'react-email';

// The roster email (docs/ux-spec.md §6.8, docs/designs/RosterEmailMessage*.dc.html), rendered once
// into a Go html/template by write.ts. Every dynamic part is a template action written as literal
// text, and Go (apps/server/internal/mail) precomputes every value, colours included: React
// escapes quotes, so no action may contain a string literal. Each style hole is a whole CSS
// property value. Light only, with inline styles, tables and system fonts.

const sans = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const mono = 'ui-monospace, Menlo, Consolas, monospace';
const ink = '#16181D';
const muted = '#5B6270';
const faint = '#6B7280';
const line = '#E3E6EA';

/** A Go template action, such as `.Subject` or `range .Weeks`, as literal text. */
const t = (action: string) => `{{${action}}}`;

const text: CSSProperties = { margin: 0, fontFamily: sans };

export function RosterEmail() {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>{t('.Subject')}</title>
      </Head>
      <Body style={{ margin: 0, padding: '32px 0', backgroundColor: '#F3F4F6', color: ink, colorScheme: 'light', fontFamily: sans }}>
        <Preview useTitleTag={false}>{t('.Preheader')}</Preview>
        <Container
          style={{
            maxWidth: '560px',
            backgroundColor: '#FFFFFF',
            border: `1px solid ${line}`,
            borderRadius: '12px',
            borderCollapse: 'separate',
            padding: '24px 20px',
          }}
        >
          <Text style={{ ...text, fontSize: '13px', lineHeight: '18px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: muted }}>
            New roster
          </Text>
          <Heading as="h1" style={{ ...text, marginTop: '6px', fontSize: '24px', lineHeight: '30px', fontWeight: 700, color: ink }}>
            {t('.Range')}
          </Heading>
          <Text style={{ ...text, marginTop: '8px', fontSize: '15px', lineHeight: '22px', color: muted }}>{t('.Summary')}</Text>

          {t('range .Weeks')}
          <Heading as="h2" style={{ ...text, margin: '24px 0 8px', fontSize: '15px', lineHeight: '22px', fontWeight: 700, color: ink }}>
            {t('.Title')}
          </Heading>
          <Section style={{ border: `1px solid ${line}`, borderRadius: '10px', borderCollapse: 'separate', overflow: 'hidden' }}>
            {t('range .Rows')}
            <Row style={{ backgroundColor: t('.RowBg'), borderTop: t('.RowLine') }}>
              <Column style={{ width: '96px', height: '32px', padding: '6px 0 6px 12px', fontFamily: sans, fontSize: '15px', color: t('.DateFg') }}>
                {t('.Date')}
              </Column>
              <Column style={{ width: '34px', padding: '6px 0 6px 12px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '24px',
                    border: '1px solid',
                    borderColor: t('.ChipLine'),
                    borderRadius: '6px',
                    backgroundColor: t('.ChipBg'),
                    color: t('.ChipFg'),
                    fontFamily: mono,
                    fontSize: '14px',
                    lineHeight: '24px',
                    fontWeight: 700,
                    textAlign: 'center',
                  }}
                >
                  {t('.Code')}
                </div>
              </Column>
              <Column style={{ padding: '6px 12px', fontFamily: sans, fontSize: '15px', fontWeight: t('.LabelWeight'), color: t('.LabelFg') }}>
                {t('.Label')}
              </Column>
            </Row>
            {t('end')}
          </Section>
          {t('end')}

          <Text style={{ ...text, marginTop: '24px', fontSize: '13px', lineHeight: '20px', color: muted }}>
            A Night shift is listed on the date it starts. Shifts can still change after a roster comes out.
          </Text>
          <Hr style={{ margin: '12px 0', border: 'none', borderTop: `1px solid ${line}` }} />
          <Text style={{ ...text, fontSize: '12px', lineHeight: '18px', color: faint }}>Sent by Roster Mate when a new roster was imported.</Text>
        </Container>
      </Body>
    </Html>
  );
}
