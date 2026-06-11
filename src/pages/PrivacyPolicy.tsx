import { Link } from "react-router-dom";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-muted">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        {/* Wordmark */}
        <div className="mb-10">
          <Link
            to="/"
            className="text-2xl font-bold tracking-tight no-underline text-primary"
          >
            Duncan
          </Link>
        </div>

        {/* Card */}
        <div className="bg-card rounded-xl shadow-sm border border-border p-6 sm:p-10">
          <h1 className="text-3xl sm:text-4xl font-bold text-card-foreground mb-2">
            Privacy Policy
          </h1>
          <p className="text-sm text-muted-foreground mb-10">
            Last updated: 11 June 2025 &nbsp;&middot;&nbsp; Effective date: 11 June 2025
          </p>

          <div className="space-y-10 text-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">1. Who We Are</h2>
              <p>
                Duncan is an AI-powered workplace assistant operated by Kabuni Sports Ltd ("we", "us", or "our"), a company registered in England and Wales (Companies House CRN 16604952), accessible at{" "}
                <a href="https://duncan.help" className="underline text-primary">duncan.help</a>. We are committed to protecting your personal information in accordance with the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018.
              </p>
              <p className="mt-2">
                If you have questions about this policy, contact us at:{" "}
                <a href="mailto:privacy@kabuni.com" className="underline text-primary">privacy@kabuni.com</a>
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">2. Information We Collect</h2>
              <p className="mb-2">
                We collect the following categories of information when you use Duncan:
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>Google Account data</strong> — when you sign in via Google OAuth, we receive your name, email address, and profile picture, and (where you grant permission) access to your Google Workspace data such as Gmail and Google Calendar.
                </li>
                <li>
                  <strong>Personal information</strong> — your name and email address, used to create and manage your account.
                </li>
                <li>
                  <strong>Usage and analytics data</strong> — information about how you interact with Duncan, including pages visited, features used, session duration, and error logs. This data is collected in aggregate to improve the service.
                </li>
                <li>
                  <strong>Technical data</strong> — IP address, browser type, device type, and operating system.
                </li>
              </ul>
              <p className="mt-2">
                We do not collect sensitive personal data (e.g. health information, financial data) unless explicitly required and disclosed.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">3. How We Use Your Information</h2>
              <p className="mb-2">We use the information we collect to:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Provide, operate, and maintain the Duncan platform</li>
                <li>Authenticate your identity via Google OAuth</li>
                <li>Personalise your experience and deliver AI-assisted features</li>
                <li>Send service-related communications (e.g. account notices, security alerts)</li>
                <li>Analyse usage patterns to improve Duncan's performance and reliability</li>
                <li>Comply with legal obligations</li>
              </ul>
              <p className="mt-2">
                We do not sell your personal data to third parties, and we do not use your data to serve third-party advertising.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">4. Legal Basis for Processing (UK GDPR)</h2>
              <p className="mb-2">We process your personal data under the following lawful bases:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>Contract</strong> — processing necessary to provide the service you have signed up for.
                </li>
                <li>
                  <strong>Consent</strong> — for Google OAuth permissions and any optional data processing you explicitly agree to.
                </li>
                <li>
                  <strong>Legitimate interests</strong> — for analytics and service improvement, where those interests are not overridden by your rights.
                </li>
                <li>
                  <strong>Legal obligation</strong> — where we are required to process data to comply with applicable law.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">5. Google OAuth &amp; API Data</h2>
              <p className="mb-2">
                Duncan's use of data received from Google APIs complies with the Google API Services User Data Policy, including the Limited Use requirements.
              </p>
              <p className="mb-2">Specifically:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>We only request the Google API scopes necessary for the features you use.</li>
                <li>We do not transfer your Google data to third parties except as necessary to provide the service.</li>
                <li>We do not use your Google data for serving advertisements.</li>
                <li>We do not allow humans to read your Google data unless you explicitly grant access or it is required for security or legal purposes.</li>
              </ul>
              <p className="mt-2">
                You can revoke Duncan's access to your Google account at any time via your Google Account permissions.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">6. Data Sharing &amp; Third Parties</h2>
              <p className="mb-2">
                We may share your data with trusted third-party service providers who assist us in operating Duncan, including:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>Cloud infrastructure</strong> — Microsoft Azure (hosting and data storage)
                </li>
                <li>
                  <strong>AI services</strong> — Anthropic (Claude LLM) for processing natural language queries
                </li>
                <li>
                  <strong>Analytics</strong> — aggregated, anonymised usage analytics providers
                </li>
              </ul>
              <p className="mt-2">
                All third-party providers are required to handle your data in accordance with applicable data protection law and our instructions. We do not share your data with any other parties without your consent, except where required by law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">7. Data Retention</h2>
              <p>
                We retain your personal data only for as long as necessary to provide the service and fulfil the purposes described in this policy. If you close your account, we will delete your personal data within 30 days, unless retention is required by law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">8. Your Rights</h2>
              <p className="mb-2">Under UK GDPR, you have the following rights:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>Access</strong> — request a copy of the personal data we hold about you.
                </li>
                <li>
                  <strong>Rectification</strong> — ask us to correct inaccurate or incomplete data.
                </li>
                <li>
                  <strong>Erasure</strong> — request deletion of your personal data ("right to be forgotten").
                </li>
                <li>
                  <strong>Restriction</strong> — ask us to limit how we process your data in certain circumstances.
                </li>
                <li>
                  <strong>Portability</strong> — receive your data in a structured, machine-readable format.
                </li>
                <li>
                  <strong>Objection</strong> — object to processing based on legitimate interests.
                </li>
                <li>
                  <strong>Withdraw consent</strong> — where processing is based on consent, withdraw it at any time.
                </li>
              </ul>
              <p className="mt-2">
                To exercise any of these rights, email us at{" "}
                <a href="mailto:privacy@kabuni.com" className="underline text-primary">privacy@kabuni.com</a>. We will respond within 30 days. You also have the right to lodge a complaint with the Information Commissioner's Office (ICO).
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">9. Cookies &amp; Tracking</h2>
              <p>
                Duncan uses essential cookies required for authentication and session management. We may also use analytics cookies to understand how the service is used. You can manage cookie preferences in your browser settings.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">10. Security</h2>
              <p>
                We implement appropriate technical and organisational measures to protect your personal data, including encryption in transit (TLS) and at rest, access controls, and regular security reviews. However, no internet transmission is completely secure, and we cannot guarantee absolute security.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">11. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify you of significant changes via email or a notice within the platform. Your continued use of Duncan after changes are published constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">12. Contact Us</h2>
              <p className="mb-2">If you have any questions or concerns about this Privacy Policy, please contact us:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Privacy enquiries:{" "}
                  <a href="mailto:privacy@kabuni.com" className="underline text-primary">privacy@kabuni.com</a>
                </li>
                <li>
                  Support:{" "}
                  <a href="mailto:duncansupport@kabuni.com" className="underline text-primary">duncansupport@kabuni.com</a>
                </li>
                <li>
                  Website:{" "}
                  <a href="https://duncan.help" className="underline text-primary">duncan.help</a>
                </li>
              </ul>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <a href="https://duncan.help/terms" className="underline text-primary">
            Terms &amp; Conditions
          </a>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
