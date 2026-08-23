import type { Plugin, RadialLinearScale } from 'chart.js'

type PortraitColors = {
  border: string
  background: string
}

/**
 * Draws a stable achievement portrait on top of a radar scale.
 *
 * Chart.js collapses a radar dataset to separate spokes when only two values
 * are greater than zero and zero-valued axes sit between them.  For the
 * portrait this is misleading: there is no visible shape.  We therefore join
 * the meaningful vertices directly.  Two values form a triangle through the
 * centre, three or more form a closed polygon, and a single value remains a
 * centre-to-vertex line.
 */
export function createAchievementPortraitPlugin(
  values: number[],
  colors: PortraitColors,
): Plugin<'radar'> {
  return {
    id: 'achievementPortraitShape',
    beforeDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0)
      const scale = chart.scales.r as RadialLinearScale | undefined
      if (!scale || meta.hidden) return

      const positivePoints = values.flatMap((value, index) => {
        if (value <= 0) return []
        const point = meta.data[index] as unknown as { x: number; y: number } | undefined
        return point ? [point] : []
      })
      if (!positivePoints.length) return

      const { ctx } = chart
      ctx.save()
      ctx.beginPath()

      if (positivePoints.length === 1) {
        ctx.moveTo(scale.xCenter, scale.yCenter)
        ctx.lineTo(positivePoints[0].x, positivePoints[0].y)
      } else if (positivePoints.length === 2) {
        ctx.moveTo(scale.xCenter, scale.yCenter)
        ctx.lineTo(positivePoints[0].x, positivePoints[0].y)
        ctx.lineTo(positivePoints[1].x, positivePoints[1].y)
        ctx.closePath()
        ctx.fillStyle = colors.background
        ctx.fill()
      } else {
        ctx.moveTo(positivePoints[0].x, positivePoints[0].y)
        for (const point of positivePoints.slice(1)) {
          ctx.lineTo(point.x, point.y)
        }
        ctx.closePath()
        ctx.fillStyle = colors.background
        ctx.fill()
      }

      ctx.strokeStyle = colors.border
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.restore()
    },
  }
}
