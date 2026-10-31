import { Link, Route, Routes } from "react-router";
import Board from "./routes/Board.tsx";
import Home from "./routes/Home.tsx";
import Leagues from "./routes/Leagues.tsx";

export default function App() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6">
        <Link to="/" className="text-xl font-semibold tracking-tight">
          DynastyData
        </Link>
        <p className="text-sm text-slate-400">Find dynasty breakout candidates before the market does.</p>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/u/:username" element={<Leagues />} />
        <Route path="/league/:leagueId" element={<Board />} />
      </Routes>
    </div>
  );
}
