import { AuthGate } from "@/components/AuthGate";

/** Link independiente: solo usuarios cobrador → app de cobro. */
export default function CobradorPage() {
  return <AuthGate channel="cobrador" />;
}
