// The docs live in the repository's docs/ folder and link to the rest of
// the repository (packages, apps) with relative paths, which read well on
// GitHub. On the portal, those links go to GitHub.
import { dirname, relative, resolve } from "node:path";
import { visit } from "unist-util-visit";

export default function remarkRepoLinks({ repoDir, docsDir, repoUrl }) {
	return (tree, file) => {
		const from = dirname(file.path);
		visit(tree, "link", (node) => {
			const url = node.url;
			if (!url || /^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url)) return;
			const [path, hash = ""] = url.split("#");
			const target = resolve(from, path);
			if (!relative(docsDir, target).startsWith("..")) return;
			const inRepo = relative(repoDir, target);
			if (inRepo.startsWith("..")) return;
			const kind = /\.[a-z0-9]+$/i.test(inRepo) ? "blob" : "tree";
			node.url = `${repoUrl}/${kind}/main/${inRepo}${hash ? `#${hash}` : ""}`;
		});
	};
}
