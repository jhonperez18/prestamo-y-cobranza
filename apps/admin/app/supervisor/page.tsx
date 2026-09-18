import { AuthGate } from "@/components/AuthGate";

/** Link independiente: solo usuarios supervisor → panel supervisor. */
export default function SupervisorPage() {
  return <AuthGate channel="supervisor" />;
}
