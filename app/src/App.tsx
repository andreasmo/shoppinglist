import { Main } from "./components/Main.tsx";
import { Onboarding } from "./components/Onboarding.tsx";
import { useStore } from "./lib/store.ts";

export function App() {
  const st = useStore();
  if (!st.ready) return <div className="splash" />;
  return st.session ? <Main /> : <Onboarding />;
}
