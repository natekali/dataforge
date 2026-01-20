import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './store'

describe('useAppStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAppStore.setState({
      currentProjectId: null,
      targetModel: null,
      currentStep: 'import',
      detectedFormat: null,
    })
  })

  it('should have correct initial state', () => {
    const state = useAppStore.getState()
    expect(state.currentProjectId).toBeNull()
    expect(state.targetModel).toBeNull()
    expect(state.currentStep).toBe('import')
    expect(state.detectedFormat).toBeNull()
  })

  it('should set current project ID', () => {
    const { setCurrentProjectId } = useAppStore.getState()
    setCurrentProjectId('project-123')
    
    expect(useAppStore.getState().currentProjectId).toBe('project-123')
  })

  it('should set target model', () => {
    const { setTargetModel } = useAppStore.getState()
    setTargetModel('llama-3')
    
    expect(useAppStore.getState().targetModel).toBe('llama-3')
  })

  it('should set current step', () => {
    const { setCurrentStep } = useAppStore.getState()
    setCurrentStep('edit')
    
    expect(useAppStore.getState().currentStep).toBe('edit')
  })

  it('should set detected format', () => {
    const { setDetectedFormat } = useAppStore.getState()
    setDetectedFormat('sharegpt')
    
    expect(useAppStore.getState().detectedFormat).toBe('sharegpt')
  })

  it('should reset state', () => {
    const store = useAppStore.getState()
    store.setCurrentProjectId('test')
    store.setTargetModel('model')
    store.setCurrentStep('export')
    
    store.reset()
    
    const newState = useAppStore.getState()
    expect(newState.currentProjectId).toBeNull()
    expect(newState.targetModel).toBeNull()
    expect(newState.currentStep).toBe('import')
  })
})
