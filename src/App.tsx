import { Link, Route, Routes } from "react-router";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import Board from "./routes/Board.tsx";
import Home from "./routes/Home.tsx";
import Leagues from "./routes/Leagues.tsx";

export default function App() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <Link to="/" className="font-display text-3xl font-bold tracking-wide">
            Dynasty<span className="text-accent">Data</span>
          </Link>
          <p className="text-sm text-muted">Find dynasty breakout candidates before the market does.</p>
        </div>
        <ThemeToggle />
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/u/:username" element={<Leagues />} />
        <Route path="/league/:leagueId" element={<Board />} />
      </Routes>
    </div>
  );
}
