import { createTool } from '@mastra/core'
import { z } from 'zod'
import { queryPapers } from '../../paper-search/utils'

export const paperSearchTool = createTool({
  id: 'paper_search',
  description:
    'Search through research papers about prompt engineering. Returns relevant chunks of text from papers along with their similarity scores and metadata. This tool is used to find relevant papers to use as a reference for prompt engineering.',
  inputSchema: z.object({
    query: z.string().describe('The search query to find relevant content in the papers')
  }),
  execute: async ({ context: { query } }) => {
    try {
      const results = await queryPapers(query, 5)

      return {
        results: results.map((result) => ({
          paperName: result.paperFileName || 'Unknown',
          similarity: result.similarity,
          textPreview: `${result.chunkText.substring(0, 300)}...`,
          metadata: {
            paperId: result.paperId,
            chunkId: result.chunkId,
            pageNumber:
              result.chunkMetadata && typeof result.chunkMetadata === 'object' && 'pageNumber' in result.chunkMetadata
                ? result.chunkMetadata.pageNumber
                : null,
            chunkIndex:
              result.chunkMetadata && typeof result.chunkMetadata === 'object' && 'chunkIndex' in result.chunkMetadata
                ? result.chunkMetadata.chunkIndex
                : null
          }
        })),
        summary: `Found ${results.length} relevant passages${results.length > 0 ? ` from paper: ${results[0].paperFileName}` : ''}.`
      }
    } catch (error) {
      console.error('Error in paper search tool:', error)
      throw new Error('Failed to search papers. Please try again or contact support if the issue persists.')
    }
  }
})
