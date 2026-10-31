import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

export default function Home() {
  const [username, setUsername] = useState("");
  const navigate = useNavigate();

  function submit(e: FormEvent) {
    e.preventDefault();
    const name = username.trim();
    if (name) navigate(`/u/${encodeURIComponent(name)}`);
  }

  return (
    <form onSubmit={submit} className="flex max-w-md gap-2">
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Sleeper username"
        className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
      />
      <button className="rounded bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500">Find leagues</button>
    </form>
  );
}
