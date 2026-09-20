/**
 * SkeletalMeshEngine - 유기적 계층 관절 캡슐 리깅 & 키네마틱스 엔진
 * 
 * 1. 계층적 관절 구조 (Hierarchical Joint Architecture):
 *    - Root(골반/Pelvis) -> Spine/Torso -> Neck -> Head
 *    - Neck -> Shoulders -> Elbows -> Hands (순운동학 FK Chain)
 *    - Pelvis -> Hips -> Knees -> Feet (2-Bone 역운동학 IK Chain)
 * 
 * 2. 관절 캡슐 오버랩 블렌딩 (Seamless Capsule Overlap):
 *    - 이미지를 임의의 삼각 그리드로 찢지 않고, 인체 해부학적 뼈대(신체 부위)를 추출
 *    - 관절 회전축(Pivot: 어깨, 팔꿈치, 힙, 무릎, 목)에 둥근 캡슐 오버랩 패딩(14~20px)을 부여하여
 *      관절이 90도 이상 꺾여도 틈새가 벌어지거나 조각나지 않고 매끄럽게 연결
 * 
 * 3. 피벗 회전 변환 (Pivot Rotation Transform):
 *    - 어깨를 중심으로 상박이 회전하고, 팔꿈치를 중심으로 하박이 연쇄 회전
 *    - 발이 지면에 닿을 때 2-Bone IK로 무릎이 자연스럽게 접힘
 *    - 텍스처 깨짐이나 모자이크 없이 100% 원본 선명도 유지 & 60 FPS 보장
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

  // 벡터 유틸리티
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
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

    // 뼈대 기본 길이
    const armL1 = dist(shoulderL0, elbowL0) || 35;
    const armL2 = dist(elbowL0, handL0) || 30;
    const armR1 = dist(shoulderR0, elbowR0) || 35;
    const armR2 = dist(elbowR0, handR0) || 30;

    const legL1 = dist(pelvis0, kneeL0) || 45;
    const legL2 = dist(kneeL0, footL0) || 45;
    const legR1 = dist(pelvis0, kneeR0) || 45;
    const legR2 = dist(kneeR0, footR0) || 45;

    // 바운스 및 틸트
    let rootDx = 0;
    let rootDy = 0;
    let pelvisTilt = 0;
    let spineTilt = 0;
    let headTilt = 0;

    // 팔 FK 각도
    let armLAngle1 = Math.atan2(elbowL0.y - shoulderL0.y, elbowL0.x - shoulderL0.x);
    let armLAngle2 = Math.atan2(handL0.y - elbowL0.y, handL0.x - elbowL0.x);
    let armRAngle1 = Math.atan2(elbowR0.y - shoulderR0.y, elbowR0.x - shoulderR0.x);
    let armRAngle2 = Math.atan2(handR0.y - elbowR0.y, handR0.x - elbowR0.x);

    // 발 IK 목표 위치
    let footTargetL = { x: footL0.x, y: footL0.y };
    let footTargetR = { x: footR0.x, y: footR0.y };
    let useLegIK = true;
    let kneeBendDirL = -1;
    let kneeBendDirR = 1;

    const motion = motionType || 'walk';

    if (motion === 'dance_full' || motion === 'dance') {
      // 1. 전신 댄스 (그루브 & 양팔 스윙 FK)
      const beat = time * 4.6;
      rootDx = Math.sin(beat * 0.5) * 10;
      rootDy = -Math.abs(Math.sin(beat)) * 12;
      pelvisTilt = Math.sin(beat * 0.5) * 0.14;
      spineTilt = -pelvisTilt * 0.7 + Math.sin(beat) * 0.06;
      headTilt = Math.sin(beat * 1.4) * 0.10;

      const armSwing = Math.sin(beat) * 0.75;
      armLAngle1 += armSwing - 0.35;
      armLAngle2 = armLAngle1 + Math.sin(beat + 0.5) * 0.7 + 0.4;

      armRAngle1 -= armSwing + 0.35;
      armRAngle2 = armRAngle1 - Math.sin(beat + 0.5) * 0.7 - 0.4;

      const stepL = Math.max(0, Math.sin(beat));
      const stepR = Math.max(0, -Math.sin(beat));
      footTargetL.x = footL0.x + Math.sin(beat * 0.5) * 8;
      footTargetL.y = footL0.y - stepL * 14;
      footTargetR.x = footR0.x + Math.sin(beat * 0.5) * 8;
      footTargetR.y = footR0.y - stepR * 14;

    } else if (motion === 'dance_lower') {
      // 2. 하체 댄스 (스쿼트 & 셔플 킥 IK)
      const beat = time * 5.0;
      const squat = Math.max(0, Math.sin(beat));
      rootDy = -squat * 16;
      pelvisTilt = Math.sin(beat * 0.5) * 0.10;
      spineTilt = -pelvisTilt * 0.6;
      headTilt = Math.sin(beat * 0.5) * 0.06;

      armLAngle1 += Math.sin(beat * 0.5) * 0.2;
      armLAngle2 = armLAngle1 + 0.5 + Math.sin(beat) * 0.25;
      armRAngle1 -= Math.sin(beat * 0.5) * 0.2;
      armRAngle2 = armRAngle1 - 0.5 - Math.sin(beat) * 0.25;

      const kickPhase = Math.sin(beat * 0.5);
      if (kickPhase > 0.25) {
        footTargetL.x = footL0.x + 16;
        footTargetL.y = footL0.y - 22 * kickPhase;
        footTargetR.y = footR0.y + rootDy * 0.2;
      } else if (kickPhase < -0.25) {
        footTargetR.x = footR0.x - 16;
        footTargetR.y = footR0.y + 22 * kickPhase;
        footTargetL.y = footL0.y + rootDy * 0.2;
      } else {
        footTargetL.y = footL0.y;
        footTargetR.y = footR0.y;
      }

    } else if (motion === 'funny') {
      // 3. 웃긴 젤리 댄스 (코믹 바운스 & 유연한 흔들림)
      rootDx = Math.sin(time * 3.4) * 12;
      rootDy = Math.sin(time * 2.6) * 10;
      pelvisTilt = Math.sin(time * 3.8) * 0.18;
      spineTilt = Math.sin(time * 4.5 + 0.8) * 0.20;
      headTilt = Math.sin(time * 5.8) * 0.24;

      armLAngle1 += Math.sin(time * 4.8) * 0.9;
      armLAngle2 = armLAngle1 + Math.sin(time * 6.2) * 1.1;

      armRAngle1 += Math.cos(time * 4.8) * 0.9;
      armRAngle2 = armRAngle1 - Math.cos(time * 6.2) * 1.1;

      footTargetL.x = footL0.x + Math.sin(time * 3.4) * 14;
      footTargetL.y = footL0.y - Math.abs(Math.sin(time * 2.6)) * 12;
      footTargetR.x = footR0.x - Math.sin(time * 3.4) * 14;
      footTargetR.y = footR0.y - Math.abs(Math.cos(time * 2.6)) * 12;

    } else if (motion === 'jump') {
      // 4. 점프 (무릎 굽히기 -> 도약 -> 체공 만세 -> 착지 완충)
      const jumpCycle = (time * 1.5) % 2.0;
      let jumpY = 0;

      if (jumpCycle < 0.45) {
        // Squat 모으기
        const p = jumpCycle / 0.45;
        jumpY = Math.sin(p * Math.PI) * 20;
        spineTilt = 0.06;
        headTilt = -0.10;
        armLAngle1 += 0.25;
        armLAngle2 = armLAngle1 + 0.6;
        armRAngle1 -= 0.25;
        armRAngle2 = armRAngle1 - 0.6;
        footTargetL.y = footL0.y;
        footTargetR.y = footR0.y;
      } else if (jumpCycle < 1.35) {
        // Fly 도약 & 체공
        const p = (jumpCycle - 0.45) / 0.9;
        const flight = Math.sin(p * Math.PI);
        jumpY = -flight * 42;
        spineTilt = -0.04;
        headTilt = 0.06;
        armLAngle1 -= 1.2;
        armLAngle2 = armLAngle1 - 0.3;
        armRAngle1 += 1.2;
        armRAngle2 = armRAngle1 + 0.3;
        footTargetL.y = footL0.y + jumpY * 0.7 + 8;
        footTargetR.y = footR0.y + jumpY * 0.7 + 8;
      } else {
        // Cushion 착지 완충
        const p = (jumpCycle - 1.35) / 0.65;
        const cushion = (1 - p) * 12;
        jumpY = cushion;
        footTargetL.y = footL0.y;
        footTargetR.y = footR0.y;
      }
      rootDy = jumpY;

    } else if (motion === 'swim') {
      // 5. 유영 (유선형 사인파 파동 Wave FK)
      useLegIK = false;
      const swimFreq = time * 3.2;
      rootDy = Math.sin(swimFreq) * 5;
      pelvisTilt = Math.sin(swimFreq) * 0.10;
      spineTilt = Math.sin(swimFreq - 0.5) * 0.12;
      headTilt = Math.sin(swimFreq - 1.0) * 0.08;

      const paddle = Math.sin(swimFreq) * 0.38;
      armLAngle1 += paddle;
      armLAngle2 = armLAngle1 + Math.sin(swimFreq - 0.3) * 0.25;
      armRAngle1 -= paddle;
      armRAngle2 = armRAngle1 - Math.sin(swimFreq - 0.3) * 0.25;

      const legWaveL = Math.sin(swimFreq - 0.8) * 14;
      const legWaveR = Math.sin(swimFreq - 1.2) * 14;

      pose.knee_l = { x: kneeL0.x + legWaveL * 0.6, y: kneeL0.y + rootDy };
      pose.foot_l = { x: footL0.x + legWaveL, y: footL0.y + rootDy };
      pose.knee_r = { x: kneeR0.x + legWaveR * 0.6, y: kneeR0.y + rootDy };
      pose.foot_r = { x: footR0.x + legWaveR, y: footR0.y + rootDy };

    } else {
      // 6. 워킹 (지면 접지 2-Bone IK + 교차 스윙 FK)
      const walkSpeed = time * 4.0;
      rootDy = -Math.abs(Math.sin(walkSpeed)) * 7;
      pelvisTilt = Math.sin(walkSpeed) * 0.07;
      spineTilt = -pelvisTilt * 0.7;
      headTilt = Math.sin(walkSpeed * 0.5) * 0.04;

      const armSwing = Math.sin(walkSpeed) * 0.48;
      armLAngle1 += armSwing;
      armLAngle2 = armLAngle1 + Math.max(0, -Math.cos(walkSpeed) * 0.35) + 0.12;

      armRAngle1 -= armSwing;
      armRAngle2 = armRAngle1 - Math.max(0, Math.cos(walkSpeed) * 0.35) - 0.12;

      const phaseL = walkSpeed;
      const phaseR = walkSpeed + Math.PI;

      const stepLiftL = Math.max(0, Math.sin(phaseL));
      footTargetL.x = footL0.x + Math.cos(phaseL) * 14;
      footTargetL.y = footL0.y - stepLiftL * 12;

      const stepLiftR = Math.max(0, Math.sin(phaseR));
      footTargetR.x = footR0.x + Math.cos(phaseR) * 14;
      footTargetR.y = footR0.y - stepLiftR * 12;
    }

    // 계층적 전파 계산
    pose.pelvis.x = pelvis0.x + rootDx;
    pose.pelvis.y = pelvis0.y + rootDy;

    const spineVecX = neck0.x - pelvis0.x;
    const spineVecY = neck0.y - pelvis0.y;
    const cosSpine = Math.cos(spineTilt);
    const sinSpine = Math.sin(spineTilt);
    pose.neck.x = pose.pelvis.x + (spineVecX * cosSpine - spineVecY * sinSpine);
    pose.neck.y = pose.pelvis.y + (spineVecX * sinSpine + spineVecY * cosSpine);

    const headVecX = head0.x - neck0.x;
    const headVecY = head0.y - neck0.y;
    const totalHeadTilt = spineTilt + headTilt;
    const cosHead = Math.cos(totalHeadTilt);
    const sinHead = Math.sin(totalHeadTilt);
    pose.head.x = pose.neck.x + (headVecX * cosHead - headVecY * sinHead);
    pose.head.y = pose.neck.y + (headVecX * sinHead + headVecY * cosHead);

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

    if (useLegIK) {
      const hipOffsetLX = (kneeL0.x - pelvis0.x) * 0.4;
      const hipOffsetRX = (kneeR0.x - pelvis0.x) * 0.4;
      const hipL = { x: pose.pelvis.x + hipOffsetLX, y: pose.pelvis.y };
      const hipR = { x: pose.pelvis.x + hipOffsetRX, y: pose.pelvis.y };

      pose.knee_l = solve2BoneIK(hipL, footTargetL, legL1, legL2, kneeBendDirL);
      pose.foot_l = footTargetL;

      pose.knee_r = solve2BoneIK(hipR, footTargetR, legR1, legR2, kneeBendDirR);
      pose.foot_r = footTargetR;
    }

    return pose;
  }

  /**
   * 캡슐 패스 생성 유틸리티 (끝점을 넘어 오버랩되는 둥근 캡슐)
   */
  function drawCapsulePath(ctx, p1, p2, radius, pad1 = 15, pad2 = 15) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const ux = dx / len;
    const uy = dy / len;

    const aX = p1.x - ux * pad1;
    const aY = p1.y - uy * pad1;
    const bX = p2.x + ux * pad2;
    const bY = p2.y + uy * pad2;

    ctx.beginPath();
    ctx.arc(aX, aY, radius, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
    ctx.arc(bX, bY, radius, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
    ctx.closePath();
  }

  /**
   * 계층적 캡슐 세그먼트 관절 엔진 (Hierarchical Capsule Joint Rigging)
   * - 관절 회전축(Pivot) 기반 부모-자식 계층 렌더링
   * - 관절 연결부 둥근 캡슐 오버랩으로 틈새(Gap)와 찢어짐(Tearing) 원천 차단
   */
  class SkinnedMesh {
    constructor(imageSource, bindSkeleton, width, height) {
      this.image = imageSource;
      this.bindSkeleton = bindSkeleton;
      this.width = width;
      this.height = height;

      this.segments = {};
      this._extractSegments();
    }

    /**
     * 원본 이미지로부터 신체 부위별 캡슐 세그먼트 캔버스 추출 & 오버랩 마스킹
     */
    _extractSegments() {
      const skel = this.bindSkeleton;
      const w = this.width;
      const h = this.height;

      // 헬퍼: 캡슐 마스크로 오프스크린 캔버스에 세그먼트 추출
      const makeSegment = (pathCallback) => {
        const cvs = document.createElement('canvas');
        cvs.width = w;
        cvs.height = h;
        const c = cvs.getContext('2d');
        c.save();
        pathCallback(c);
        c.clip();
        c.drawImage(this.image, 0, 0, w, h);
        c.restore();
        return cvs;
      };

      // 1. 머리 (Head): 목에서 머리 중심까지, 넉넉한 반경 + 목 오버랩
      const headDist = dist(skel.neck, skel.head) || 30;
      const headRad = headDist * 0.95 + 16;
      this.segments.head = makeSegment((c) => {
        drawCapsulePath(c, skel.neck, skel.head, headRad, 18, 22);
      });

      // 2. 왼쪽 상박 (Upper Arm L): 어깨 -> 팔꿈치
      const armL1Dist = dist(skel.shoulder_l, skel.elbow_l) || 30;
      const armL1Rad = armL1Dist * 0.42 + 12;
      this.segments.upper_arm_l = makeSegment((c) => {
        drawCapsulePath(c, skel.shoulder_l, skel.elbow_l, armL1Rad, 16, 16);
      });

      // 3. 왼쪽 하박 (Lower Arm L): 팔꿈치 -> 손
      const armL2Dist = dist(skel.elbow_l, skel.hand_l) || 28;
      const armL2Rad = armL2Dist * 0.42 + 12;
      this.segments.lower_arm_l = makeSegment((c) => {
        drawCapsulePath(c, skel.elbow_l, skel.hand_l, armL2Rad, 16, 18);
      });

      // 4. 오른쪽 상박 (Upper Arm R): 어깨 -> 팔꿈치
      const armR1Dist = dist(skel.shoulder_r, skel.elbow_r) || 30;
      const armR1Rad = armR1Dist * 0.42 + 12;
      this.segments.upper_arm_r = makeSegment((c) => {
        drawCapsulePath(c, skel.shoulder_r, skel.elbow_r, armR1Rad, 16, 16);
      });

      // 5. 오른쪽 하박 (Lower Arm R): 팔꿈치 -> 손
      const armR2Dist = dist(skel.elbow_r, skel.hand_r) || 28;
      const armR2Rad = armR2Dist * 0.42 + 12;
      this.segments.lower_arm_r = makeSegment((c) => {
        drawCapsulePath(c, skel.elbow_r, skel.hand_r, armR2Rad, 16, 18);
      });

      // 6. 왼쪽 허벅지 (Upper Leg L): 골반/힙 -> 무릎
      const legL1Dist = dist(skel.pelvis, skel.knee_l) || 38;
      const legL1Rad = legL1Dist * 0.42 + 14;
      this.segments.upper_leg_l = makeSegment((c) => {
        drawCapsulePath(c, skel.pelvis, skel.knee_l, legL1Rad, 18, 16);
      });

      // 7. 왼쪽 종아리 (Lower Leg L): 무릎 -> 발
      const legL2Dist = dist(skel.knee_l, skel.foot_l) || 35;
      const legL2Rad = legL2Dist * 0.42 + 14;
      this.segments.lower_leg_l = makeSegment((c) => {
        drawCapsulePath(c, skel.knee_l, skel.foot_l, legL2Rad, 16, 18);
      });

      // 8. 오른쪽 허벅지 (Upper Leg R): 골반/힙 -> 무릎
      const legR1Dist = dist(skel.pelvis, skel.knee_r) || 38;
      const legR1Rad = legR1Dist * 0.42 + 14;
      this.segments.upper_leg_r = makeSegment((c) => {
        drawCapsulePath(c, skel.pelvis, skel.knee_r, legR1Rad, 18, 16);
      });

      // 9. 오른쪽 종아리 (Lower Leg R): 무릎 -> 발
      const legR2Dist = dist(skel.knee_r, skel.foot_r) || 35;
      const legR2Rad = legR2Dist * 0.42 + 14;
      this.segments.lower_leg_r = makeSegment((c) => {
        drawCapsulePath(c, skel.knee_r, skel.foot_r, legR2Rad, 16, 18);
      });

      // 10. 몸통 (Torso): 목에서 골반 중심, 어깨와 힙을 아우르는 넉넉한 캡슐
      const torsoDist = dist(skel.neck, skel.pelvis) || 50;
      const shoulderSpan = dist(skel.shoulder_l, skel.shoulder_r) || 60;
      const torsoRad = Math.max(torsoDist * 0.55, shoulderSpan * 0.45) + 12;
      this.segments.torso = makeSegment((c) => {
        drawCapsulePath(c, skel.neck, skel.pelvis, torsoRad, 16, 18);
      });
    }

    /**
     * 부위별 피벗 회전 변환을 적용하여 그리기
     */
    _drawPart(ctx, segImg, pivotBind, pivotCurr, angleDelta) {
      if (!segImg) return;
      ctx.save();
      // 1. 현재 월드 관절 위치로 이동
      ctx.translate(pivotCurr.x, pivotCurr.y);
      // 2. 관절 회전량만큼 회전
      ctx.rotate(angleDelta);
      // 3. 바인드 포즈의 관절 회전축으로 정렬
      ctx.translate(-pivotBind.x, -pivotBind.y);
      // 4. 원본 픽셀 그대로 선명하게 그리기
      ctx.drawImage(segImg, 0, 0);
      ctx.restore();
    }

    /**
     * 실시간 관절 렌더링
     */
    draw(ctx, currSkel, destX, destY, destW, destH) {
      if (!this.image) return;

      const skel0 = this.bindSkeleton;
      const scaleX = destW / this.width;
      const scaleY = destH / this.height;

      ctx.save();
      ctx.translate(destX, destY);
      ctx.scale(scaleX, scaleY);

      // 관절별 회전각(Delta Angle) 계산
      const getDeltaAngle = (p1Bind, p2Bind, p1Curr, p2Curr) => {
        const a0 = Math.atan2(p2Bind.y - p1Bind.y, p2Bind.x - p1Bind.x);
        const a1 = Math.atan2(p2Curr.y - p1Curr.y, p2Curr.x - p1Curr.x);
        return a1 - a0;
      };

      const spineDelta = getDeltaAngle(skel0.pelvis, skel0.neck, currSkel.pelvis, currSkel.neck);
      const headDelta = getDeltaAngle(skel0.neck, skel0.head, currSkel.neck, currSkel.head);

      const armL1Delta = getDeltaAngle(skel0.shoulder_l, skel0.elbow_l, currSkel.shoulder_l, currSkel.elbow_l);
      const armL2Delta = getDeltaAngle(skel0.elbow_l, skel0.hand_l, currSkel.elbow_l, currSkel.hand_l);

      const armR1Delta = getDeltaAngle(skel0.shoulder_r, skel0.elbow_r, currSkel.shoulder_r, currSkel.elbow_r);
      const armR2Delta = getDeltaAngle(skel0.elbow_r, skel0.hand_r, currSkel.elbow_r, currSkel.hand_r);

      const legL1Delta = getDeltaAngle(skel0.pelvis, skel0.knee_l, currSkel.pelvis, currSkel.knee_l);
      const legL2Delta = getDeltaAngle(skel0.knee_l, skel0.foot_l, currSkel.knee_l, currSkel.foot_l);

      const legR1Delta = getDeltaAngle(skel0.pelvis, skel0.knee_r, currSkel.pelvis, currSkel.knee_r);
      const legR2Delta = getDeltaAngle(skel0.knee_r, skel0.foot_r, currSkel.knee_r, currSkel.foot_r);

      // 계층적 렌더링 순서 (깊이감 보장: 뒤쪽 팔다리 -> 몸통 -> 앞쪽 다리 -> 머리 -> 앞쪽 팔)
      // 1. 뒤쪽 팔 (Right Arm)
      this._drawPart(ctx, this.segments.upper_arm_r, skel0.shoulder_r, currSkel.shoulder_r, armR1Delta);
      this._drawPart(ctx, this.segments.lower_arm_r, skel0.elbow_r, currSkel.elbow_r, armR2Delta);

      // 2. 뒤쪽 다리 (Right Leg)
      this._drawPart(ctx, this.segments.upper_leg_r, skel0.pelvis, currSkel.pelvis, legR1Delta);
      this._drawPart(ctx, this.segments.lower_leg_r, skel0.knee_r, currSkel.knee_r, legR2Delta);

      // 3. 앞쪽 다리 (Left Leg)
      this._drawPart(ctx, this.segments.upper_leg_l, skel0.pelvis, currSkel.pelvis, legL1Delta);
      this._drawPart(ctx, this.segments.lower_leg_l, skel0.knee_l, currSkel.knee_l, legL2Delta);

      // 4. 몸통 (Torso)
      this._drawPart(ctx, this.segments.torso, skel0.pelvis, currSkel.pelvis, spineDelta);

      // 5. 머리 (Head)
      this._drawPart(ctx, this.segments.head, skel0.neck, currSkel.neck, headDelta);

      // 6. 앞쪽 팔 (Left Arm)
      this._drawPart(ctx, this.segments.upper_arm_l, skel0.shoulder_l, currSkel.shoulder_l, armL1Delta);
      this._drawPart(ctx, this.segments.lower_arm_l, skel0.elbow_l, currSkel.elbow_l, armL2Delta);

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
