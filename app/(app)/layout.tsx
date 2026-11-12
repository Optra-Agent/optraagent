import { AppNav } from "../../components/app/AppNav";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app-frame">
      <AppNav />
      <div className="app-content">{children}</div>
      <footer className="app-footer">
        <span>PAPER ONLY</span>
        <span>Live trading disabled · V4 claim level L0</span>
      </footer>
    </div>
  );
}
