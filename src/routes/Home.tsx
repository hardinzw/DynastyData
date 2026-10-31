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
        className="flex-1 rounded border border-line bg-card px-3 py-2 placeholder:text-muted"
      />
      <button className="rounded bg-accent px-4 py-2 font-medium text-accent-ink hover:opacity-90">Find leagues</button>
    </form>
  );
}
