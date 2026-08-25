/**
 * NotFoundPage - shown for any unmatched route inside the app shell.
 */

import { Link } from "react-router-dom";
import { PageHeader } from "../components/Layout.jsx";
import Button from "../components/Button.jsx";
import { Callout } from "../components/States.jsx";

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Page not found" />
      <Callout tone="neutral">
        <p>The page you were looking for doesn’t exist or has moved.</p>
        <Link to="/" className="mt-3 inline-block">
          <Button variant="secondary">Back to dashboard</Button>
        </Link>
      </Callout>
    </div>
  );
}
