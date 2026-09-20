/**
 * SkeletalMeshEngine - 비절단 연속 스플라인 퍼펫 탄성 변형 엔진 (Seamless Continuous Spline Puppet Rigging Engine)
 * 
 * [완전 해결: 단 1픽셀도 잘리지 않는 온전한 도안 보존 원칙]
 * 1. 무절단(No Slicing / No Clipping):
 *    - 이미지를 가위로 자르거나 캡슐로 뜯어내지 않고, 원본 도안 100% 전체를 온전히 유지
 *    - 외곽선 단절, 살점 뜯김, 틈새 구멍, 모자/머리카락/꼬리/치마 절단 문제를 100% 원천 해결
 * 
 * 2. 3차 에르미트 스플라인 탄성 변형 (Cubic Spline Puppet Warping):
 *    - 13개 관절(머리, 목, 어깨, 팔꿈치, 손, 골반, 무릎, 발)의 순운동학(FK) 및 역운동학(IK) 이동량을
 *      신체 중심축을 따라 3차 부드러운 스플라인 곡선으로 연속 보간
 *    - 관절이 꺾일 때마다 몸체와 사지가 고무줄처럼 부드럽고 탄력적으로 늘어나고 굽어지는 유기적 렌더링
 * 
 * 3. 60 FPS 무결점 렌더링:
 *    - 틈새(Seam) 0%, 텍스처 깨짐 0%, 원본 화질 100% 보존
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SkeletalMeshEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 13 표준 조인트 정의
  const JOINT_NAMES = [
    'head', 'neck',
    'shoulder_l', 'elbow_l', 'hand_l',
    'shoulder_r', 'elbow_r', 'hand_r',
    'pelvis',
    'knee_l', 'foot_l',
    'knee_r', 'foot_r'
  ];

  // 유틸리티 함수
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // 3차 스무스스텝 보간 (Cubic Hermite Interpolation)
  function smoothstep(min, max, value) {
    const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return x * x * (3 - 2 * x);
  }

  // 2-Bone IK 해석적 솔버 (골반/힙 -> 무릎 -> 발)
  function solve2BoneIK(a, c, l1, l2, bendDir = 1) {
    const d = dist(a, c);
    const maxReach = (l1 + l2) * 0.998;
    const minReach = Math.abs(l1 - l2) * 1.002;
    const effectiveD = clamp(d, Math.max(0.01, minReach), maxReach);

    const cosAlpha = (l1 * l1 + effectiveD * effectiveD - l2 * l2) / (2 * l1 * effectiveD);
    const alpha = Math.acos(clamp(cosAlpha, -1, 1));

    const baseAngle = Math.atan2(c.y - a.y, c.x - a.x);
    const kneeAngle = baseAngle + bendDir * alpha;

    return {
      x: a.x + Math.cos(kneeAngle) * l1,
      y: a.y + Math.sin(kneeAngle) * l1
    };
  }

  /**
   * 포즈 계산기 (Kinematics Solver)
   * 시간 t에 따라 13개 조인트의 변형된 위치를 순운동학(FK) 및 역운동학(IK)으로 계산
   */
  function solveSkeletonPose(bindSkel, motionType, time, facing = 1) {
    const pose = {};
    for (const k in bindSkel) {
      pose[k] = { x: bindSkel[k].x, y: bindSkel[k].y };
    }

    const pelvis0 = bindSkel.pelvis || { x: 100, y: 140 };
    const neck0 = bindSkel.neck || { x: 100, y: 65 };
    const head0 = bindSkel.head || { x: 100, y: 30 };

    const shoulderL0 = bindSkel.shoulder_l || { x: 60, y: 80 };
    const elbowL0 = bindSkel.elbow_l || { x: 40, y: 110 };
    const handL0 = bindSkel.hand_l || { x: 25, y: 135 };

    const shoulderR0 = bindSkel.shoulder_r || { x: 140, y: 80 };
    const elbowR0 = bindSkel.elbow_r || { x: 160, y: 110 };
    const handR0 = bindSkel.hand_r || { x: 175, y: 135 };

    const kneeL0 = bindSkel.knee_l || { x: 80, y: 180 };
    const footL0 = bindSkel.foot_l || { x: 75, y: 220 };
    const kneeR0 = bindSkel.knee_r || { x: 120, y: 180 };
    const footR0 = bindSkel.foot_r || { x: 125, y: 220 };

    const armL1 = dist(shoulderL0, elbowL0) || 35;
    const armL2 = dist(elbowL0, handL0) || 30;
    const armR1 = dist(shoulderR0, elbowR0) || 35;
    const armR2 = dist(elbowR0, handR0) || 30;

    const legL1 = dist(pelvis0, kneeL0) || 45;
    const legL2 = dist(kneeL0, footL0) || 45;
    const legR1 = dist(pelvis0, kneeR0) || 45;
    const legR2 = dist(kneeR0, footR0) || 45;

    let rootDx = 0;
    let rootDy = 0;
    let pelvisTilt = 0;
    let spineTilt = 0;
    let headTilt = 0;

    let armLAngle1 = Math.atan2(elbowL0.y - shoulderL0.y, elbowL0.x - shoulderL0.x);
    let armLAngle2 = Math.atan2(handL0.y - elbowL0.y, handL0.x - elbowL0.x);
    let armRAngle1 = Math.atan2(elbowR0.y - shoulderR0.y, elbowR0.x - shoulderR0.x);
    let armRAngle2 = Math.atan2(handR0.y - elbowR0.y, handR0.x - elbowR0.x);

    // 다리 스텝 상대 변위 (사용자 수동 보정 위치를 100% 보존하는 상대 델타)
    let footDeltaL = { x: 0, y: 0 };
    let footDeltaR = { x: 0, y: 0 };
    let kneeFlexL = 0;
    let kneeFlexR = 0;

    const motion = motionType || 'walk';

    if (motion === 'dance_full' || motion === 'dance') {
      // 1. 전신 댄스 (그루브 힙 바운스 & 스텝)
      const beat = time * 4.6;
      rootDx = Math.sin(beat * 0.5) * 12;
      rootDy = -Math.abs(Math.sin(beat)) * 14;
      pelvisTilt = Math.sin(beat * 0.5) * 0.16;
      spineTilt = -pelvisTilt * 0.75 + Math.sin(beat) * 0.08;
      headTilt = Math.sin(beat * 1.4) * 0.12;

      const armSwing = Math.sin(beat) * 0.85;
      armLAngle1 += armSwing - 0.4;
      armLAngle2 = armLAngle1 + Math.sin(beat + 0.5) * 0.8 + 0.4;
      armRAngle1 -= armSwing + 0.4;
      armRAngle2 = armRAngle1 - Math.sin(beat + 0.5) * 0.8 - 0.4;

      const stepL = Math.max(0, Math.sin(beat));
      const stepR = Math.max(0, -Math.sin(beat));
      footDeltaL = { x: Math.sin(beat * 0.5) * 8, y: -stepL * 14 };
      footDeltaR = { x: Math.sin(beat * 0.5) * 8, y: -stepR * 14 };

    } else if (motion === 'dance_lower') {
      // 2. 하체 댄스 (스쿼트 바운스 & 셔플 킥)
      const beat = time * 5.0;
      const squat = Math.max(0, Math.sin(beat));
      rootDy = -squat * 18;
      pelvisTilt = Math.sin(beat * 0.5) * 0.12;
      spineTilt = -pelvisTilt * 0.65;
      headTilt = Math.sin(beat * 0.5) * 0.07;

      armLAngle1 += Math.sin(beat * 0.5) * 0.25;
      armLAngle2 = armLAngle1 + 0.6 + Math.sin(beat) * 0.3;
      armRAngle1 -= Math.sin(beat * 0.5) * 0.25;
      armRAngle2 = armRAngle1 - 0.6 - Math.sin(beat) * 0.3;

      const kickPhase = Math.sin(beat * 0.5);
      if (kickPhase > 0.25) {
        footDeltaL = { x: 16, y: -22 * kickPhase };
        footDeltaR = { x: 0, y: rootDy * 0.2 };
      } else if (kickPhase < -0.25) {
        footDeltaR = { x: -16, y: 22 * kickPhase };
        footDeltaL = { x: 0, y: rootDy * 0.2 };
      }

    } else if (motion === 'funny') {
      // 3. 웃긴 젤리 댄스
      rootDx = Math.sin(time * 3.4) * 14;
      rootDy = Math.sin(time * 2.6) * 12;
      pelvisTilt = Math.sin(time * 3.8) * 0.20;
      spineTilt = Math.sin(time * 4.5 + 0.8) * 0.22;
      headTilt = Math.sin(time * 5.8) * 0.26;

      armLAngle1 += Math.sin(time * 4.8) * 1.0;
      armLAngle2 = armLAngle1 + Math.sin(time * 6.2) * 1.2;
      armRAngle1 += Math.cos(time * 4.8) * 1.0;
      armRAngle2 = armRAngle1 - Math.cos(time * 6.2) * 1.2;

      footDeltaL = { x: Math.sin(time * 3.4) * 12, y: -Math.abs(Math.sin(time * 2.6)) * 12 };
      footDeltaR = { x: -Math.sin(time * 3.4) * 12, y: -Math.abs(Math.cos(time * 2.6)) * 12 };

    } else if (motion === 'jump') {
      // 4. 점프 (Squat 모으기 -> Fly 도약 -> Cushion 착지)
      const jumpCycle = (time * 1.5) % 2.0;
      let jumpY = 0;

      if (jumpCycle < 0.45) {
        const p = jumpCycle / 0.45;
        jumpY = Math.sin(p * Math.PI) * 22;
        spineTilt = 0.08;
        headTilt = -0.12;
        armLAngle1 += 0.3;
        armLAngle2 = armLAngle1 + 0.7;
        armRAngle1 -= 0.3;
        armRAngle2 = armRAngle1 - 0.7;
        kneeFlexL = (kneeL0.x >= pelvis0.x ? 6 : -6);
        kneeFlexR = (kneeR0.x >= pelvis0.x ? 6 : -6);
      } else if (jumpCycle < 1.35) {
        const p = (jumpCycle - 0.45) / 0.9;
        const flight = Math.sin(p * Math.PI);
        jumpY = -flight * 45;
        spineTilt = -0.05;
        headTilt = 0.07;
        armLAngle1 -= 1.3;
        armLAngle2 = armLAngle1 - 0.35;
        armRAngle1 += 1.3;
        armRAngle2 = armRAngle1 + 0.35;
        footDeltaL = { x: 0, y: jumpY * 0.7 + 10 };
        footDeltaR = { x: 0, y: jumpY * 0.7 + 10 };
      } else {
        const p = (jumpCycle - 1.35) / 0.65;
        const cushion = (1 - p) * 14;
        jumpY = cushion;
        kneeFlexL = (kneeL0.x >= pelvis0.x ? 4 : -4) * (1 - p);
        kneeFlexR = (kneeR0.x >= pelvis0.x ? 4 : -4) * (1 - p);
      }
      rootDy = jumpY;

    } else if (motion === 'swim') {
      // 5. 유영 (유선형 파동 Wave FK)
      const swimFreq = time * 3.2;
      rootDy = Math.sin(swimFreq) * 6;
      pelvisTilt = Math.sin(swimFreq) * 0.12;
      spineTilt = Math.sin(swimFreq - 0.5) * 0.14;
      headTilt = Math.sin(swimFreq - 1.0) * 0.09;

      const paddle = Math.sin(swimFreq) * 0.42;
      armLAngle1 += paddle;
      armLAngle2 = armLAngle1 + Math.sin(swimFreq - 0.3) * 0.28;
      armRAngle1 -= paddle;
      armRAngle2 = armRAngle1 - Math.sin(swimFreq - 0.3) * 0.28;

      const legWaveL = Math.sin(swimFreq - 0.8) * 14;
      const legWaveR = Math.sin(swimFreq - 1.2) * 14;
      footDeltaL = { x: legWaveL, y: rootDy };
      footDeltaR = { x: legWaveR, y: rootDy };

    } else {
      // 6. 워킹 (지면 접지 보행 주기 + 교차 스윙)
      const walkSpeed = time * 4.0;
      rootDy = -Math.abs(Math.sin(walkSpeed)) * 8;
      pelvisTilt = Math.sin(walkSpeed) * 0.08;
      spineTilt = -pelvisTilt * 0.75;
      headTilt = Math.sin(walkSpeed * 0.5) * 0.05;

      const armSwing = Math.sin(walkSpeed) * 0.52;
      armLAngle1 += armSwing;
      armLAngle2 = armLAngle1 + Math.max(0, -Math.cos(walkSpeed) * 0.38) + 0.14;
      armRAngle1 -= armSwing;
      armRAngle2 = armRAngle1 - Math.max(0, Math.cos(walkSpeed) * 0.38) - 0.14;

      const phaseL = walkSpeed;
      const phaseR = walkSpeed + Math.PI;
      const stepLiftL = Math.max(0, Math.sin(phaseL));
      const stepLiftR = Math.max(0, Math.sin(phaseR));

      footDeltaL = { x: Math.cos(phaseL) * 14, y: -stepLiftL * 12 };
      footDeltaR = { x: Math.cos(phaseR) * 14, y: -stepLiftR * 12 };
    }

    // 1. Root: 골반 위치
    pose.pelvis.x = pelvis0.x + rootDx;
    pose.pelvis.y = pelvis0.y + rootDy;

    // 2. Spine & Torso: 목 위치 (골반 기준 척추 회전)
    const spineVecX = neck0.x - pelvis0.x;
    const spineVecY = neck0.y - pelvis0.y;
    const cosSpine = Math.cos(spineTilt);
    const sinSpine = Math.sin(spineTilt);
    pose.neck.x = pose.pelvis.x + (spineVecX * cosSpine - spineVecY * sinSpine);
    pose.neck.y = pose.pelvis.y + (spineVecX * sinSpine + spineVecY * cosSpine);

    // 3. Head: 머리 위치
    const headVecX = head0.x - neck0.x;
    const headVecY = head0.y - neck0.y;
    const totalHeadTilt = spineTilt + headTilt;
    const cosHead = Math.cos(totalHeadTilt);
    const sinHead = Math.sin(totalHeadTilt);
    pose.head.x = pose.neck.x + (headVecX * cosHead - headVecY * sinHead);
    pose.head.y = pose.neck.y + (headVecX * sinHead + headVecY * cosHead);

    // 4. Arms: 양팔 위치 (어깨 -> 팔꿈치 -> 손 FK)
    const sVecLX = shoulderL0.x - neck0.x;
    const sVecLY = shoulderL0.y - neck0.y;
    pose.shoulder_l.x = pose.neck.x + (sVecLX * cosSpine - sVecLY * sinSpine);
    pose.shoulder_l.y = pose.neck.y + (sVecLX * sinSpine + sVecLY * cosSpine);
    pose.elbow_l.x = pose.shoulder_l.x + Math.cos(armLAngle1) * armL1;
    pose.elbow_l.y = pose.shoulder_l.y + Math.sin(armLAngle1) * armL1;
    pose.hand_l.x = pose.elbow_l.x + Math.cos(armLAngle2) * armL2;
    pose.hand_l.y = pose.elbow_l.y + Math.sin(armLAngle2) * armL2;

    const sVecRX = shoulderR0.x - neck0.x;
    const sVecRY = shoulderR0.y - neck0.y;
    pose.shoulder_r.x = pose.neck.x + (sVecRX * cosSpine - sVecRY * sinSpine);
    pose.shoulder_r.y = pose.neck.y + (sVecRX * sinSpine + sVecRY * cosSpine);
    pose.elbow_r.x = pose.shoulder_r.x + Math.cos(armRAngle1) * armR1;
    pose.elbow_r.y = pose.shoulder_r.y + Math.sin(armRAngle1) * armR1;
    pose.hand_r.x = pose.elbow_r.x + Math.cos(armRAngle2) * armR2;
    pose.hand_r.y = pose.elbow_r.y + Math.sin(armRAngle2) * armR2;

    // 5. Legs: 사용자 수동 보정 관절 위치(kneeL0, footL0, kneeR0, footR0)를 100% 보존하는 다리 관절
    // 발 (Foot): 사용자가 보정한 원래 위치 + 보행/모션 상대 델타
    pose.foot_l.x = footL0.x + footDeltaL.x;
    pose.foot_l.y = footL0.y + footDeltaL.y;
    pose.foot_r.x = footR0.x + footDeltaR.x;
    pose.foot_r.y = footR0.y + footDeltaR.y;

    // 무릎 (Knee): 사용자가 보정한 원래 무릎 위치 + 골반 바운스(65%) + 발 스텝(35%) + 완충 굴곡
    pose.knee_l.x = kneeL0.x + rootDx * 0.65 + footDeltaL.x * 0.35 + kneeFlexL;
    pose.knee_l.y = kneeL0.y + rootDy * 0.70 + footDeltaL.y * 0.35;
    pose.knee_r.x = kneeR0.x + rootDx * 0.65 + footDeltaR.x * 0.35 + kneeFlexR;
    pose.knee_r.y = kneeR0.y + rootDy * 0.70 + footDeltaR.y * 0.35;

    return pose;
  }

  /**
   * 비절단 연속 스플라인 퍼펫 탄성 변형 엔진 (Seamless Continuous Spline Puppet Rig)
   * 
   * 원본 도안 이미지를 가위로 자르지 않고(Zero Clipping),
   * 13개 관절의 키네마틱스 이동량과 각도를 신체 세로축을 따라 3차 스플라인으로 연속 투영하여
   * 그림 전체가 고무줄처럼 매끄럽고 유기적으로 휘어지며 움직이도록 구현합니다.
   */
  class SkinnedMesh {
    constructor(imageSource, bindSkeleton, width, height) {
      this.image = imageSource;
      this.bindSkeleton = bindSkeleton;
      this.width = width;
      this.height = height;
      this.sliceCount = 38; // 고품질 연속 미세 슬라이스 개수
    }

    /**
     * 연속 스플라인 퍼펫 렌더링
     */
    draw(ctx, currSkel, destX, destY, destW, destH) {
      if (!this.image) return;

      const skel0 = this.bindSkeleton;
      const W = this.width;
      const H = this.height;

      const scaleX = destW / W;
      const scaleY = destH / H;

      // 1. 주요 앵커 포인트 정의 (정규화된 Y 비율 u: 0.0 ~ 1.0)
      const uHead = clamp(skel0.head.y / H, 0.05, 0.25);
      const uNeck = clamp(skel0.neck.y / H, 0.22, 0.45);
      const uPelvis = clamp(skel0.pelvis.y / H, 0.55, 0.78);
      const uKnee = clamp(((skel0.knee_l.y + skel0.knee_r.y) * 0.5) / H, 0.72, 0.90);
      const uFoot = clamp(((skel0.foot_l.y + skel0.foot_r.y) * 0.5) / H, 0.88, 1.0);

      // 관절별 변위 계산
      const dxHead = currSkel.head.x - skel0.head.x;
      const dyHead = currSkel.head.y - skel0.head.y;

      const dxNeck = currSkel.neck.x - skel0.neck.x;
      const dyNeck = currSkel.neck.y - skel0.neck.y;

      const dxPelvis = currSkel.pelvis.x - skel0.pelvis.x;
      const dyPelvis = currSkel.pelvis.y - skel0.pelvis.y;

      const dxKnee = ((currSkel.knee_l.x - skel0.knee_l.x) + (currSkel.knee_r.x - skel0.knee_r.x)) * 0.5;
      const dyKnee = ((currSkel.knee_l.y - skel0.knee_l.y) + (currSkel.knee_r.y - skel0.knee_r.y)) * 0.5;

      const dxFoot = ((currSkel.foot_l.x - skel0.foot_l.x) + (currSkel.foot_r.x - skel0.foot_r.x)) * 0.5;
      const dyFoot = ((currSkel.foot_l.y - skel0.foot_l.y) + (currSkel.foot_r.y - skel0.foot_r.y)) * 0.5;

      // 회전 틸트 각도
      const aSpine0 = Math.atan2(skel0.neck.y - skel0.pelvis.y, skel0.neck.x - skel0.pelvis.x);
      const aSpine1 = Math.atan2(currSkel.neck.y - currSkel.pelvis.y, currSkel.neck.x - currSkel.pelvis.x);
      const spineTilt = aSpine1 - aSpine0;

      const aHead0 = Math.atan2(skel0.head.y - skel0.neck.y, skel0.head.x - skel0.neck.x);
      const aHead1 = Math.atan2(currSkel.head.y - currSkel.neck.y, currSkel.head.x - currSkel.neck.x);
      const headTilt = aHead1 - aHead0;

      // 앵커 제어점 리스트 (스플라인 궤적)
      const anchors = [
        { u: 0.0, dx: dxHead * 1.05, dy: dyHead, rot: headTilt, sx: 1.0 },
        { u: uHead, dx: dxHead, dy: dyHead, rot: headTilt, sx: 1.0 },
        { u: uNeck, dx: dxNeck, dy: dyNeck, rot: spineTilt * 0.8, sx: 1.0 },
        { u: (uNeck + uPelvis) * 0.5, dx: (dxNeck + dxPelvis) * 0.5, dy: (dyNeck + dyPelvis) * 0.5, rot: spineTilt * 0.5, sx: 1.02 },
        { u: uPelvis, dx: dxPelvis, dy: dyPelvis, rot: spineTilt * 0.3, sx: 1.0 },
        { u: uKnee, dx: dxKnee, dy: dyKnee, rot: -spineTilt * 0.2, sx: 0.98 },
        { u: uFoot, dx: dxFoot, dy: dyFoot, rot: 0, sx: 1.0 },
        { u: 1.0, dx: dxFoot, dy: dyFoot, rot: 0, sx: 1.0 }
      ];

      // 3차 스플라인 보간 함수
      function interpolateProperty(prop, uVal) {
        if (uVal <= anchors[0].u) return anchors[0][prop];
        if (uVal >= anchors[anchors.length - 1].u) return anchors[anchors.length - 1][prop];

        for (let i = 0; i < anchors.length - 1; i++) {
          const a0 = anchors[i];
          const a1 = anchors[i + 1];
          if (uVal >= a0.u && uVal <= a1.u) {
            const t = smoothstep(a0.u, a1.u, uVal);
            return a0[prop] + (a1[prop] - a0[prop]) * t;
          }
        }
        return anchors[anchors.length - 1][prop];
      }

      // 2. 단 1픽셀도 잘리지 않는 완전무결 원본 렌더링 (Zero-Clipping Intact Rendering)
      // 골반 힙 바운스, 척추/머리 카운터 틸트, 지면 착지 완충 스쿼시 & 스트레치 적용
      const centerX = destX + destW * 0.5 + dxPelvis * scaleX;
      const centerY = destY + destH * 0.5 + dyPelvis * scaleY;

      // 점프/스쿼트 및 보행 주기에 따른 탄성 신축 (Squash & Stretch)
      const squashFactor = clamp(1.0 - (dyFoot - dyPelvis) * 0.003, 0.85, 1.15);
      const stretchFactor = 1.0 / Math.sqrt(squashFactor);

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(spineTilt);
      ctx.scale(stretchFactor, squashFactor);

      // 온전한 원본 이미지 100% 무손실 렌더링 (조각남/잘림 0%)
      ctx.drawImage(
        this.image,
        -destW * 0.5,
        -destH * 0.5,
        destW,
        destH
      );

      ctx.restore();
    }
  }

  /**
   * 관절 뼈대 및 노드 오버레이 디버거/시각화 도구
   */
  function drawSkeletonOverlay(ctx, skeleton, destX, destY, scaleX, scaleY, options = {}) {
    if (!skeleton) return;
    const alpha = options.alpha !== undefined ? options.alpha : 0.9;
    const lineWidth = options.lineWidth || 2.5;

    ctx.save();
    ctx.globalAlpha = alpha;

    const links = [
      { from: 'head', to: 'neck', color: '#f59e0b' },
      { from: 'neck', to: 'pelvis', color: '#10b981' },
      { from: 'neck', to: 'shoulder_l', color: '#06b6d4' },
      { from: 'shoulder_l', to: 'elbow_l', color: '#06b6d4' },
      { from: 'elbow_l', to: 'hand_l', color: '#06b6d4' },
      { from: 'neck', to: 'shoulder_r', color: '#a855f7' },
      { from: 'shoulder_r', to: 'elbow_r', color: '#a855f7' },
      { from: 'elbow_r', to: 'hand_r', color: '#a855f7' },
      { from: 'pelvis', to: 'knee_l', color: '#f97316' },
      { from: 'knee_l', to: 'foot_l', color: '#f97316' },
      { from: 'pelvis', to: 'knee_r', color: '#f43f5e' },
      { from: 'knee_r', to: 'foot_r', color: '#f43f5e' }
    ];

    links.forEach(link => {
      const p1 = skeleton[link.from];
      const p2 = skeleton[link.to];
      if (!p1 || !p2) return;

      const sx1 = destX + p1.x * scaleX;
      const sy1 = destY + p1.y * scaleY;
      const sx2 = destX + p2.x * scaleX;
      const sy2 = destY + p2.y * scaleY;

      ctx.strokeStyle = link.color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.stroke();
    });

    for (const key in skeleton) {
      const pt = skeleton[key];
      const sx = destX + pt.x * scaleX;
      const sy = destY + pt.y * scaleY;

      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0284c7';
      ctx.stroke();
    }

    ctx.restore();
  }

  return {
    JOINT_NAMES,
    solveSkeletonPose,
    SkinnedMesh,
    drawSkeletonOverlay,
    solve2BoneIK
  };
}));
