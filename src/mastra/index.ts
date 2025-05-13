import { Mastra } from '@mastra/core'
import { promptEnhancerWorkflow } from './workflow'
import { promptEnhancerAgent } from './agents'
export const mastra = new Mastra({
  agents: {
    promptEnhancerAgent
  },
  workflows: {
    promptEnhancerWorkflow
  }
})
