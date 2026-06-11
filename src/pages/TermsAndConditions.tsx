import { Link } from "react-router-dom";

const TermsAndConditions = () => {
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
            Terms &amp; Conditions
          </h1>
          <p className="text-sm text-muted-foreground mb-10">
            Last updated: 11 June 2025 &nbsp;&middot;&nbsp; Effective date: 11 June 2025
          </p>

          <div className="space-y-10 text-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">1. About These Terms</h2>
              <p>
                These Terms &amp; Conditions ("Terms") govern your access to and use of Duncan, an AI-powered workplace assistant available at{" "}
                <a href="https://duncan.help" className="underline text-primary">duncan.help</a> ("the Service"), operated by Kabuni Sports Ltd, a company registered in England and Wales (Companies House CRN 16604952) ("we", "us", or "our").
              </p>
              <p className="mt-2">
                By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, please do not use the Service. These Terms are governed by the laws of England and Wales.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">2. Eligibility</h2>
              <p>
                You must be at least 18 years old and have the legal capacity to enter into a binding agreement to use Duncan. By using the Service, you represent that you meet these requirements.
              </p>
              <p className="mt-2">
                If you are using Duncan on behalf of an organisation, you represent that you are authorised to bind that organisation to these Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">3. Your Account</h2>
              <p className="mb-2">
                Access to Duncan requires you to sign in using a Google account via OAuth. You are responsible for:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Maintaining the security of your Google account credentials</li>
                <li>All activity that occurs under your account</li>
                <li>
                  Notifying us immediately of any unauthorised use at{" "}
                  <a href="mailto:duncansupport@kabuni.com" className="underline text-primary">duncansupport@kabuni.com</a>
                </li>
              </ul>
              <p className="mt-2">
                We reserve the right to suspend or terminate accounts that violate these Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">4. Use of the Service</h2>
              <p className="mb-2">
                You agree to use Duncan only for lawful purposes and in accordance with these Terms. You must not:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Use the Service in any way that violates applicable UK or international law or regulation</li>
                <li>Attempt to gain unauthorised access to any part of the Service or its infrastructure</li>
                <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
                <li>Use the Service to transmit harmful, offensive, or fraudulent content</li>
                <li>Resell or commercially exploit the Service without our written consent</li>
                <li>Interfere with the integrity or performance of the Service</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">5. AI-Generated Content</h2>
              <p className="mb-2">
                Duncan uses artificial intelligence to generate responses and assist with tasks. You acknowledge that:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>AI-generated content may not always be accurate, complete, or up to date</li>
                <li>You are responsible for reviewing and verifying any AI-generated output before acting on it</li>
                <li>Duncan is not a substitute for professional legal, financial, medical, or other specialist advice</li>
                <li>We do not guarantee that the Service will meet your specific requirements or expectations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">6. Intellectual Property</h2>
              <p className="mb-2">
                All content, features, and functionality of Duncan — including but not limited to software, design, text, and graphics — are owned by or licensed to us and are protected by intellectual property laws.
              </p>
              <p className="mb-2">
                You retain ownership of any content you submit to the Service. By submitting content, you grant us a limited, non-exclusive licence to process that content solely to provide the Service to you.
              </p>
              <p>
                You may not reproduce, distribute, or create derivative works from any part of the Service without our prior written consent.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">7. Third-Party Services</h2>
              <p>
                Duncan integrates with third-party services including Google (OAuth and Workspace APIs), Microsoft Azure, and Anthropic. Your use of those services is subject to their respective terms and privacy policies. We are not responsible for the availability, accuracy, or practices of any third-party service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">8. Disclaimers</h2>
              <p className="mb-2">
                The Service is provided on an "as is" and "as available" basis without warranties of any kind, either express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement.
              </p>
              <p>
                We do not warrant that the Service will be uninterrupted, error-free, or free of viruses or other harmful components.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">9. Limitation of Liability</h2>
              <p className="mb-2">
                To the fullest extent permitted by applicable law, Duncan shall not be liable for any indirect, incidental, special, consequential, or punitive damages — including loss of profits, data, goodwill, or business interruption — arising out of or in connection with your use of, or inability to use, the Service.
              </p>
              <p className="mb-2">
                Our total liability to you for any claims arising under these Terms shall not exceed the amount you paid (if any) for access to the Service in the 12 months preceding the claim.
              </p>
              <p>
                Nothing in these Terms excludes or limits liability for death or personal injury caused by negligence, fraud, or any other liability that cannot be excluded by English law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">10. Indemnification</h2>
              <p>
                You agree to indemnify, defend, and hold harmless Duncan and its officers, employees, and agents from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising out of or in connection with your use of the Service or your violation of these Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">11. Termination</h2>
              <p className="mb-2">
                We reserve the right to suspend or terminate your access to the Service at any time, with or without notice, for any reason including breach of these Terms.
              </p>
              <p>
                You may stop using the Service at any time. Provisions of these Terms that by their nature should survive termination will do so, including intellectual property, disclaimers, and limitation of liability.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">12. Changes to These Terms</h2>
              <p>
                We may update these Terms from time to time. We will notify you of material changes via email or a notice within the Service. Your continued use of Duncan after updated Terms are published constitutes your acceptance of the changes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">13. Governing Law &amp; Disputes</h2>
              <p>
                These Terms are governed by and construed in accordance with the laws of England and Wales. Any disputes arising out of or in connection with these Terms shall be subject to the exclusive jurisdiction of the courts of England and Wales.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-card-foreground mb-3">14. Contact Us</h2>
              <p className="mb-2">If you have any questions about these Terms, please contact us:</p>
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
          <a href="https://duncan.help/privacy" className="underline text-primary">
            Privacy Policy
          </a>
        </div>
      </div>
    </div>
  );
};

export default TermsAndConditions;
