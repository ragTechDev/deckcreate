import React, { useMemo } from 'react';
import { useVideoConfig, useCurrentFrame, Sequence } from 'remotion';
import type { Segment, GraphicsCue } from '../types/transcript';
import type { Brand } from '../types/brand';
import type { Section } from './SegmentPlayer';

// Core / general editing overlays
import { ConceptExplainer, NameTitle, ChapterMarker } from './overlays/lower-thirds';

// Keyword-triggered overlays
import {
  AwardsOverlay,
  CodingOverlay, EngineeringOverlay,
  AIOverlay,
  InfrastructureOverlay,
  PracticeOverlay,
  RoleOverlay,
  LanguageOverlay, FrameworkOverlay,
  EducationOverlay,
  RagtechOverlay,
} from './overlays/keywords';

interface OverlayRendererProps {
  segments: Segment[];
  brand: Brand;
  /** Sections for the main (non-hook) video — used to remap raw audio time to rendered frame */
  mainSections: Section[];
  /** Sections for hook clips — used to remap hook raw audio time to rendered frame */
  hookSections: Section[];
  /** First composition frame of the main section (totalHookFrames + introFrames) */
  mainStartFrame: number;
}

// Map of component names to their React components
const COMPONENT_MAP: Record<string, React.FC<any>> = {
  // Concept overlays
  AwardsOverlay,
  CodingOverlay,
  EngineeringOverlay,
  AIOverlay,
  InfrastructureOverlay,
  PracticeOverlay,
  RoleOverlay,
  LanguageOverlay,
  FrameworkOverlay,
  EducationOverlay,
  RagtechOverlay,
  // Lower-third overlays
  ConceptExplainer,
  NameTitle,
  ChapterMarker,
};

/**
 * Convert a raw audio timestamp (seconds) to its composition frame using a
 * list of sections (trimBefore/trimAfter in frames).  Each section is a
 * contiguous clip from the source; gaps between sections are cuts that don't
 * appear in the output.  The returned value is relative to the start of the
 * section group (i.e. frame 0 of the hook group, or frame 0 of the main group).
 */
function rawTimeToGroupFrame(atSeconds: number, sections: Section[], fps: number): number {
  const rawFrame = Math.round(atSeconds * fps);
  let rendered = 0;
  for (const section of sections) {
    const dur = section.trimAfter - section.trimBefore;
    if (rawFrame >= section.trimAfter) {
      // This entire section plays before our target — add its full duration.
      rendered += dur;
    } else if (rawFrame >= section.trimBefore) {
      // Our target falls inside this section.
      rendered += rawFrame - section.trimBefore;
      break;
    } else {
      // rawFrame is before this section starts — target precedes the group entirely.
      break;
    }
  }
  return rendered;
}

export const OverlayRenderer: React.FC<OverlayRendererProps> = ({
  segments,
  brand,
  mainSections,
  hookSections,
  mainStartFrame,
}) => {
  const { fps } = useVideoConfig();
  const currentFrame = useCurrentFrame();

  // Collect all graphics cues from all segments with their timing info
  const graphicsCues = useMemo(() => {
    const cues: Array<{
      cue: GraphicsCue;
      startFrame: number;
      durationInFrames: number;
      key: string;
      nextMarkerFrame?: number;
    }> = [];

    let totalGraphics = 0;
    segments.forEach((segment) => {
      if (segment.cut) return;
      if (!segment.graphics || segment.graphics.length === 0) return;
      totalGraphics += segment.graphics.length;

      segment.graphics.forEach((graphic, idx) => {
        const fullDurationFrames = Math.round(graphic.duration * fps);

        if (segment.hook) {
          // Hook segment: add cue to BOTH hook and main timelines

          // 1. Hook timeline (capped to hook clip length, or to hook section end for ChapterMarkers)
          const hookStartFrame = rawTimeToGroupFrame(graphic.at, hookSections, fps);
          let hookDuration = fullDurationFrames;
          if (segment.hookFrom !== undefined && segment.hookTo !== undefined) {
            const hookClipDuration = Math.round((segment.hookTo - segment.hookFrom) * fps);
            hookDuration = Math.min(hookDuration, hookClipDuration);
          }
          // For ChapterMarkers in hooks: cap to total hook sections duration so they don't carry into main
          if (graphic.type === 'ChapterMarker' && hookSections.length > 0) {
            const totalHookDuration = hookSections.reduce((sum, s) => sum + (s.trimAfter - s.trimBefore), 0);
            const maxAllowedDuration = totalHookDuration - hookStartFrame;
            console.log(`[OverlayRenderer] ChapterMarker hook calc: totalHookDuration=${totalHookDuration}, hookStartFrame=${hookStartFrame}, maxAllowed=${maxAllowedDuration}, originalDuration=${hookDuration}`);
            hookDuration = Math.min(hookDuration, maxAllowedDuration);
          }
          const finalDuration = Math.max(1, Math.floor(hookDuration));
          cues.push({
            cue: graphic,
            startFrame: hookStartFrame,
            durationInFrames: finalDuration,
            key: `${segment.id}-${idx}-hook-${graphic.type}`,
          });
          console.log(`[OverlayRenderer] Hook cue ${graphic.type} on seg ${segment.id}: hookStart=${hookStartFrame}, duration=${finalDuration}, endFrame=${hookStartFrame + finalDuration}`);

          // 2. Main timeline (full duration at original position)
          const mainCueStartFrame = mainStartFrame + rawTimeToGroupFrame(graphic.at, mainSections, fps);
          cues.push({
            cue: graphic,
            startFrame: mainCueStartFrame,
            durationInFrames: fullDurationFrames,
            key: `${segment.id}-${idx}-main-${graphic.type}`,
          });
          console.log(`[OverlayRenderer] Main cue ${graphic.type} on seg ${segment.id}: mainStart=${mainCueStartFrame}, duration=${fullDurationFrames}`);
        } else {
          // Non-hook segment: add to main timeline only
          const startFrame = mainStartFrame + rawTimeToGroupFrame(graphic.at, mainSections, fps);
          cues.push({
            cue: graphic,
            startFrame,
            durationInFrames: fullDurationFrames,
            key: `${segment.id}-${idx}-${graphic.type}`,
          });
        }
      });
    });

    // Sort by startFrame, then cap each duration so it ends when the next one starts.
    // Special handling for ChapterMarker: extends until next ChapterMarker or ChapterMarkerEnd cue.
    cues.sort((a, b) => a.startFrame - b.startFrame);
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const isChapterMarker = cue.cue.type === 'ChapterMarker';
      const isChapterMarkerEnd = cue.cue.type === 'ChapterMarkerEnd';

      if (isChapterMarkerEnd) {
        // End cues don't render - they just mark the end of a chapter marker
        cue.durationInFrames = 1;
        continue;
      }

      if (isChapterMarker) {
        // Skip extension for hook ChapterMarkers - they should end when hook ends
        const isHookCue = cue.key.includes('-hook-');
        if (isHookCue) {
          // Cap duration to next hook ChapterMarker so they don't overlap
          let nextHookMarkerStart = Infinity;
          for (let j = i + 1; j < cues.length; j++) {
            const nextIsHook = cues[j].key.includes('-hook-');
            if (nextIsHook && (cues[j].cue.type === 'ChapterMarker' || cues[j].cue.type === 'ChapterMarkerEnd')) {
              nextHookMarkerStart = cues[j].startFrame;
              break;
            }
          }
          const cappedDuration = Math.max(1, Math.min(cue.durationInFrames, nextHookMarkerStart - cue.startFrame));
          cues[i] = {
            ...cue,
            durationInFrames: cappedDuration,
            nextMarkerFrame: nextHookMarkerStart !== Infinity ? nextHookMarkerStart : undefined,
          };
          continue;
        }

        // Find the next ChapterMarker or ChapterMarkerEnd cue
        let nextMarkerStartFrame = Infinity;
        for (let j = i + 1; j < cues.length; j++) {
          if (cues[j].cue.type === 'ChapterMarker' || cues[j].cue.type === 'ChapterMarkerEnd') {
            nextMarkerStartFrame = cues[j].startFrame;
            break;
          }
        }
        // Previous marker fades out as next one starts - no gap
        // Fade-out is 60 frames, so marker ends exactly when next starts
        const FADE_OUT_FRAMES = 60;
        const requestedDuration = cue.durationInFrames;
        const availableDuration = nextMarkerStartFrame - cue.startFrame;
        // Cap duration so fade-out completes exactly when next marker starts
        const maxDuration = Math.min(Math.max(requestedDuration, availableDuration), nextMarkerStartFrame - cue.startFrame);
        cues[i] = { ...cue, durationInFrames: maxDuration, nextMarkerFrame: nextMarkerStartFrame };
      } else {
        // Normal cues: cap at next cue's start
        if (i < cues.length - 1) {
          const maxDuration = cues[i + 1].startFrame - cue.startFrame;
          if (cue.durationInFrames > maxDuration) {
            cues[i] = { ...cue, durationInFrames: Math.max(1, maxDuration) };
          }
        }
      }
    }

    console.log(`[OverlayRenderer] Found ${totalGraphics} graphics in ${segments.length} segments`);
    console.log('[OverlayRenderer] All cues:', cues.map(c => ({ type: c.cue.type, start: c.startFrame, dur: c.durationInFrames })));
    return cues;
  }, [segments, fps, mainSections, hookSections, mainStartFrame]);

  // Find cues that should be currently visible
  const visibleCues = graphicsCues.filter(
    (g) => currentFrame >= g.startFrame && currentFrame < g.startFrame + g.durationInFrames
  );

  console.log(`[OverlayRenderer] Frame ${currentFrame}: ${visibleCues.length} visible cues out of ${graphicsCues.length} total`);

  if (visibleCues.length === 0) {
    return null;
  }

  return (
    <>
      {visibleCues.map(({ cue, startFrame, durationInFrames, key, nextMarkerFrame }) => {
        const Component = COMPONENT_MAP[cue.type];
        if (!Component) {
          console.warn(`Unknown overlay component: ${cue.type}`);
          return null;
        }

        // Pass brand, durationInFrames, and other props (excluding brand string from transcript)
        const { brand: _, ...otherProps } = cue.props || {};
        const props: any = {
          ...otherProps,
          brand,
          durationInFrames,
        };

        // Pass nextMarkerFrame to ChapterMarker for fade-out timing
        if (cue.type === 'ChapterMarker' && nextMarkerFrame !== undefined) {
          props.nextMarkerFrame = nextMarkerFrame;
        }

        console.log(`[OverlayRenderer] Rendering ${cue.type} at frame ${startFrame} for ${durationInFrames} frames`);

        return (
          <Sequence
            key={key}
            from={startFrame}
            durationInFrames={durationInFrames}
            layout="none"
          >
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100, pointerEvents: 'none' }}>
              <Component {...props} />
            </div>
          </Sequence>
        );
      })}
    </>
  );
};
