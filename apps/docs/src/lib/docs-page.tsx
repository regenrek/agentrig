import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import browserCollections from "fumadocs-mdx:collections/browser";
import { Suspense } from "react";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { source } from "@/lib/source";
import { baseOptions } from "@/lib/layout.shared";
import { mdxComponents } from "@/lib/mdx-components";

export const loadDocsPage = createServerFn({
  method: "GET",
})
  .inputValidator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();

    return {
      path: page.path,
      pageTree: await source.serializePageTree(source.getPageTree()),
    };
  });

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: MDX },
    props: {
      className?: string;
    },
  ) {
    return (
      <DocsPage toc={toc} {...props}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <DocsBody>
          <MDX components={mdxComponents} />
        </DocsBody>
      </DocsPage>
    );
  },
});

export async function preloadDocsPage(path: string) {
  await clientLoader.preload(path);
}

export function DocsPageView({
  data,
}: {
  data: Awaited<ReturnType<typeof loadDocsPage>>;
}) {
  const pageData = useFumadocsLoader(data);

  return (
    <DocsLayout {...baseOptions()} tree={pageData.pageTree}>
      <Suspense>
        {clientLoader.useContent(pageData.path, {
          className: "",
        })}
      </Suspense>
    </DocsLayout>
  );
}
