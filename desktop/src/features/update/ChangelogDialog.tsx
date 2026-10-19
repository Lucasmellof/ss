import { useEffect, useState } from "react";
import { desktop } from "@/lib/platform";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Changes = { status: "loading" } | { status: "ready"; items: string[] } | { status: "error"; message: string };

export function formatReleaseDate(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR");
}

export function ChangelogDialog({ entry, onClose }: { entry: ChangelogEntry | undefined; onClose: () => void }) {
	const [changes, setChanges] = useState<Changes>({ status: "loading" });

	useEffect(() => {
		if (!entry?.previousTag || !desktop) {
			setChanges({ status: "ready", items: [] });
			return;
		}
		let active = true;
		setChanges({ status: "loading" });
		desktop
			.releaseChanges(entry.tag, entry.previousTag)
			.then((items) => {
				if (active) setChanges({ status: "ready", items });
			})
			.catch((cause: unknown) => {
				if (active)
					setChanges({
						status: "error",
						message: cause instanceof Error ? cause.message : "Não foi possível carregar as mudanças",
					});
			});
		return () => {
			active = false;
		};
	}, [entry]);

	const date = entry ? formatReleaseDate(entry.publishedAt) : "";
	const empty = changes.status === "ready" && changes.items.length === 0 && !entry?.notes;

	return (
		<Dialog open={entry !== undefined} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[80vh] overflow-y-auto border-app-line bg-app-panel text-app-text">
				<DialogHeader>
					<DialogTitle>Novidades da versão {entry?.version}</DialogTitle>
					<DialogDescription className="text-app-muted">
						{date ? `Publicada em ${date}` : "Mudanças desta versão"}
					</DialogDescription>
				</DialogHeader>
				{entry?.notes ? <p className="text-sm whitespace-pre-wrap text-app-text">{entry.notes}</p> : null}
				{changes.status === "loading" ? <p className="text-sm text-app-muted">Carregando mudanças...</p> : null}
				{changes.status === "error" ? <p className="text-sm text-app-danger">{changes.message}</p> : null}
				{changes.status === "ready" && changes.items.length > 0 ? (
					<ul className="list-disc space-y-1.5 pl-5 text-sm">
						{changes.items.map((item, index) => (
							<li key={`${index}-${item}`}>{item}</li>
						))}
					</ul>
				) : null}
				{empty ? <p className="text-sm text-app-muted">Nenhuma mudança registrada para esta versão.</p> : null}
				{entry ? (
					<a className="text-sm text-app-accent hover:underline" href={entry.url} target="_blank" rel="noreferrer">
						Ver no GitHub
					</a>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
