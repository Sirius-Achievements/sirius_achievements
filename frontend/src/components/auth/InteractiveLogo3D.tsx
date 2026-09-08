import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

import { useTheme } from '@/hooks/useTheme'

const MODEL_URL = `${import.meta.env.BASE_URL}brand/sirius-achievements-symbol.glb`
const FALLBACK_LOGO_URL = `${import.meta.env.BASE_URL}brand/sirius-achievements-symbol.svg`
type Theme = 'light' | 'dark'

function disposeModel(model: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    geometries.add(child.geometry)
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value)
      }
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  textures.forEach((texture) => texture.dispose())
}

export function InteractiveLogo3D() {
  const stageRef = useRef<HTMLDivElement>(null)
  const appearanceRef = useRef<((theme: Theme) => void) | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const { theme } = useTheme()
  const themeRef = useRef(theme)

  useEffect(() => {
    themeRef.current = theme
    appearanceRef.current?.(theme)
  }, [theme])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    // Each mount owns its canvas; StrictMode must not reuse a lost context.
    const canvas = document.createElement('canvas')
    canvas.className = 'auth-logo-3d__canvas'
    canvas.setAttribute('aria-hidden', 'true')
    const context = canvas.getContext('webgl2', { alpha: true, antialias: true })
    if (!context) {
      setStatus('fallback')
      return
    }

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true })
    } catch {
      setStatus('fallback')
      return
    }
    stage.appendChild(canvas)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
    const logoRoot = new THREE.Group()
    scene.add(logoRoot)

    const environmentGenerator = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const environment = environmentGenerator.fromScene(room, 0.04)
    scene.environment = environment.texture
    room.dispose()
    environmentGenerator.dispose()

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5)
    keyLight.position.set(-3, 4, 5)
    const fillLight = new THREE.DirectionalLight(0xd9f5ff, 1.1)
    fillLight.position.set(4, -1, 3)
    scene.add(keyLight, fillLight)

    const pointer = new THREE.Vector2()
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let model: THREE.Object3D | null = null
    let modelSize = new THREE.Vector3(3, 2, 0.3)
    let disposed = false
    let visible = true
    let frame = 0
    let lastFrameTime = 0

    const render = (now: number) => {
      frame = 0
      if (disposed || document.hidden || !visible) return
      const delta = Math.min((now - lastFrameTime) / 1000 || 1 / 60, 0.05)
      lastFrameTime = now
      const targetX = motionPreference.matches ? 0 : pointer.y * 0.23
      const targetY = motionPreference.matches ? 0 : pointer.x * 0.38
      const easing = 1 - Math.exp(-delta * 9)
      logoRoot.rotation.x = THREE.MathUtils.lerp(logoRoot.rotation.x, targetX, easing)
      logoRoot.rotation.y = THREE.MathUtils.lerp(logoRoot.rotation.y, targetY, easing)
      renderer.render(scene, camera)
      if (Math.abs(logoRoot.rotation.x - targetX) + Math.abs(logoRoot.rotation.y - targetY) > 0.0001) {
        frame = requestAnimationFrame(render)
      }
    }
    const invalidate = () => {
      if (!frame && !disposed && !document.hidden && visible) frame = requestAnimationFrame(render)
    }

    const resize = () => {
      const { width, height } = stage.getBoundingClientRect()
      if (!width || !height) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      const fitHeight = modelSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))
      const fitWidth = fitHeight * (modelSize.x / modelSize.y) / camera.aspect
      camera.position.set(0, 0, Math.max(fitHeight, fitWidth) * 1.18 + modelSize.z)
      camera.updateProjectionMatrix()
      invalidate()
    }

    const applyTheme = (nextTheme: Theme) => {
      const dark = nextTheme === 'dark'
      fillLight.color.set(dark ? 0xffd5c3 : 0xd9f5ff)
      model?.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.color.set(dark ? '#b34230' : '#4cbdcf')
            material.metalness = 0.3
            material.roughness = 0.3
            material.envMapIntensity = 0.75
          }
        }
      })
      invalidate()
    }
    appearanceRef.current = applyTheme

    const move = (event: PointerEvent) => {
      if (motionPreference.matches || event.pointerType === 'touch') return
      const rect = stage.getBoundingClientRect()
      pointer.set(
        THREE.MathUtils.clamp((event.clientX - rect.left - rect.width / 2) / Math.max(rect.width, 1), -1, 1),
        THREE.MathUtils.clamp((event.clientY - rect.top - rect.height / 2) / Math.max(rect.height, 1), -1, 1),
      )
      invalidate()
    }
    const reset = () => {
      pointer.set(0, 0)
      invalidate()
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      cancelAnimationFrame(frame)
      frame = 0
      setStatus('fallback')
    }
    const contextRestored = () => {
      if (model) setStatus('ready')
      invalidate()
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(stage)
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      invalidate()
    })
    intersectionObserver.observe(stage)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('blur', reset)
    document.documentElement.addEventListener('pointerleave', reset)
    document.addEventListener('visibilitychange', invalidate)
    motionPreference.addEventListener('change', reset)
    canvas.addEventListener('webglcontextlost', contextLost)
    canvas.addEventListener('webglcontextrestored', contextRestored)
    resize()

    new GLTFLoader().load(MODEL_URL, (gltf) => {
      if (disposed) {
        disposeModel(gltf.scene)
        return
      }
      model = gltf.scene
      const bounds = new THREE.Box3().setFromObject(model)
      const scale = 3 / Math.max(bounds.getSize(new THREE.Vector3()).x, 0.001)
      model.scale.setScalar(scale)
      bounds.setFromObject(model)
      model.position.sub(bounds.getCenter(new THREE.Vector3()))
      modelSize = bounds.getSize(new THREE.Vector3())
      logoRoot.add(model)
      applyTheme(themeRef.current)
      resize()
      setStatus('ready')
    }, undefined, (error) => {
      if (!disposed) {
        console.warn('Logo model could not be loaded; using the static symbol.', error)
        setStatus('fallback')
      }
    })

    return () => {
      disposed = true
      appearanceRef.current = null
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('blur', reset)
      document.documentElement.removeEventListener('pointerleave', reset)
      document.removeEventListener('visibilitychange', invalidate)
      motionPreference.removeEventListener('change', reset)
      canvas.removeEventListener('webglcontextlost', contextLost)
      canvas.removeEventListener('webglcontextrestored', contextRestored)
      if (model) disposeModel(model)
      environment.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [])

  return (
    <div className={`auth-logo-3d auth-logo-3d--${status}`} role="img" aria-label="Логотип Sirius Achievements">
      <div ref={stageRef} className="auth-logo-3d__stage" aria-hidden="true" />
      {status === 'loading' ? <span className="auth-logo-3d__loader" aria-hidden="true" /> : null}
      {status === 'fallback' ? (
        <span className="auth-logo-3d__fallback" style={{ maskImage: `url(${FALLBACK_LOGO_URL})` }} aria-hidden="true" />
      ) : null}
    </div>
  )
}
