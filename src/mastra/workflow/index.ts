import { Workflow, Step } from '@mastra/core'
import { z } from 'zod'
import { promptEnhancerAgent } from '../agents'

const promptEnhancerStep = new Step({
  id: 'prompt-enhancer',
  description: 'Enhance the prompt using the prompt-enhancer agent',
  inputSchema: z.object({
    prompt: z.string().describe('The prompt to enhance')
  }),
  outputSchema: z.object({
    enhancedPrompt: z.string().describe('The enhanced prompt')
  }),
  execute: async ({ context: { triggerData } }) => {
    const result = await promptEnhancerAgent.generate([{ role: 'user', content: triggerData.prompt }], {
      maxSteps: 40,
      temperature: 0.8,
      topK: 0.9,
      toolChoice: 'auto'
    })
    return {
      enhancedPrompt: result.steps[result.steps.length - 1].text
    }
  }
})

const promptEnhancerWorkflow = new Workflow({
  name: 'prompt-enhancer',
  triggerSchema: z.object({
    prompt: z.string().describe('The prompt to enhance')
  })
})

promptEnhancerWorkflow.step(promptEnhancerStep).commit()

export { promptEnhancerWorkflow }
