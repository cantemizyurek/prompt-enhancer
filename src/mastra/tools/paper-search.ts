import { createTool } from "@mastra/core";
import { z } from "zod";
import { queryPapers } from "../../paper-search/utils";
import { and, sql } from "drizzle-orm";
import { schema } from "../../db";
import { db } from "../../db";
import { eq } from "drizzle-orm";

export const getPaperChunkTool = createTool({
  id: "get_paper_chunk",
  description:
    "Retrieves the complete text of a specific chunk from a research paper. Use this tool after finding relevant papers with paper_search to access additional context.",
  inputSchema: z.object({
    paperId: z.string().describe("The ID of the paper"),
    chunkIndex: z.number().describe("The index of the chunk to retrieve"),
  }),
  execute: async ({ context: { paperId, chunkIndex } }) => {
    try {
      const [chunk] = await db
        .select()
        .from(schema.paperChunks)
        .where(
          and(
            eq(schema.paperChunks.paperId, paperId),
            sql`metadata->>'chunkIndex' = ${chunkIndex.toString()}`
          )
        );

      if (!chunk) {
        return {
          text: "Chunk not found",
          metadata: { paperId, chunkIndex },
        };
      }

      return {
        text: chunk.chunkText,
        metadata: { paperId, chunkIndex },
      };
    } catch (error) {
      console.error("Error in getPaperChunk tool:", error);
      throw new Error(
        "Failed to retrieve paper chunk. Please try again or contact support if the issue persists."
      );
    }
  },
});

export const paperSearchTool = createTool({
  id: "paper_search",
  description:
    "Search through research papers about prompt engineering. Returns relevant chunks of text from papers along with their similarity scores and metadata. This tool is used to find relevant papers to use as a reference for prompt engineering.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("The search query to find relevant content in the papers"),
  }),
  execute: async ({ context: { query } }) => {
    try {
      const results = await queryPapers(query, 5);

      return {
        results: results.map((result) => ({
          paperName: result.paperFileName || "Unknown",
          similarity: result.similarity,
          text: result.chunkText,
          metadata: {
            paperId: result.paperId,
            chunkId: result.chunkId,
            pageNumber:
              result.chunkMetadata &&
              typeof result.chunkMetadata === "object" &&
              "pageNumber" in result.chunkMetadata
                ? result.chunkMetadata.pageNumber
                : null,
            chunkIndex:
              result.chunkMetadata &&
              typeof result.chunkMetadata === "object" &&
              "chunkIndex" in result.chunkMetadata
                ? result.chunkMetadata.chunkIndex
                : null,
          },
        })),
        summary: `Found ${results.length} relevant passages${
          results.length > 0 ? ` from paper: ${results[0].paperFileName}` : ""
        }.`,
      };
    } catch (error) {
      console.error("Error in paper search tool:", error);
      throw new Error(
        "Failed to search papers. Please try again or contact support if the issue persists."
      );
    }
  },
});

export const evaluateTool = createTool({
  id: "evaluate_findings",
  description:
    "Process and evaluate research findings to determine the most effective prompt engineering techniques to apply. This tool helps analyze the collected information and decide how to best combine different methods.",
  inputSchema: z.object({
    findings: z
      .array(
        z.object({
          technique: z
            .string()
            .describe("Name of the prompt engineering technique"),
          source: z
            .string()
            .describe("Paper or source where the technique was found"),
          relevance: z
            .number()
            .min(0)
            .max(1)
            .describe("Relevance score (0-1) for this technique"),
          notes: z.string().describe("Key observations about the technique"),
        })
      )
      .describe("Array of research findings to evaluate"),
  }),
  execute: async ({ context: { findings } }) => {
    const evaluatedTechniques = findings.sort(
      (a, b) => b.relevance - a.relevance
    );

    return {
      evaluatedTechniques,
      summary: `Evaluated ${findings.length} techniques for effectiveness and compatibility.`,
    };
  },
});
