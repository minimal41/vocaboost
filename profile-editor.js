// プロフィール（ユーザー名・自己紹介・プロフィール写真）の編集処理。
// user.html（自分のプロフィールページ）から使う。
// 呼び出し元ページが初期化済みの firebase / db / ログイン中ユーザーをそのまま渡す。
(function () {
  const BIO_MAX_LENGTH = 200;
  const USERNAME_MAX_LENGTH = 30;
  // 表示箇所の最大サイズはuser.htmlの120pxのため、高DPI(2倍)分を見込んだ240pxで十分。
  // この写真はlocalStorageにも(単語帳ごとに複製されて)保存されるため、
  // サイズを落として容量超過(QuotaExceededError)を起きにくくする。
  const AVATAR_OUTPUT_SIZE = 240;
  const CROP_VIEWPORT_SIZE = 260;

  // 自分の単語帳にownerName/ownerPhotoURL等として複製している値を更新する
  // （list.html/view.htmlは未ログインの閲覧者でも表示できるよう複製を使っているため）
  async function updateOwnedBooks(db, uid, patch) {
    try {
      const snap = await db.collection("wordbooks").where("owner", "==", uid).get();
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 450) {
        const batch = db.batch();
        docs.slice(i, i + 450).forEach(d => batch.update(d.ref, patch));
        await batch.commit();
      }
    } catch (e) {
      console.error("所有する単語帳への反映に失敗しました", e);
    }
  }

  async function saveUsername(db, user, rawName) {
    const name = String(rawName || "").trim();
    if (!name) throw new Error("ユーザー名を入力してください");
    if (name.length > USERNAME_MAX_LENGTH) {
      throw new Error(`ユーザー名は${USERNAME_MAX_LENGTH}文字以内で入力してください`);
    }
    await user.updateProfile({ displayName: name });
    await db.collection("users").doc(user.uid).set({ username: name }, { merge: true });
    updateOwnedBooks(db, user.uid, { ownerName: name });
    if (window.VOCABOOST_UPDATE_HEADER_AVATAR) {
      window.VOCABOOST_UPDATE_HEADER_AVATAR({ username: name });
    }
    return name;
  }

  // 前後の空白と、連続しすぎる空行を整理して保存する。空文字なら自己紹介の削除になる
  function normalizeBio(rawBio) {
    return String(rawBio || "").trim().replace(/\n{3,}/g, "\n\n");
  }

  async function saveBio(db, uid, rawBio) {
    const bio = normalizeBio(rawBio);
    if (bio.length > BIO_MAX_LENGTH) {
      throw new Error(`自己紹介は${BIO_MAX_LENGTH}文字以内で入力してください`);
    }
    await db.collection("users").doc(uid).set({ bio }, { merge: true });
    return bio;
  }

  // photoURLにnullを渡すと写真を削除する
  async function savePhoto(db, uid, photoURL) {
    await db.collection("users").doc(uid).set({
      photoURL: photoURL || firebase.firestore.FieldValue.delete()
    }, { merge: true });
    updateOwnedBooks(db, uid, { ownerPhotoURL: photoURL || null });
    if (window.VOCABOOST_UPDATE_HEADER_AVATAR) {
      window.VOCABOOST_UPDATE_HEADER_AVATAR({ photoURL: photoURL || null });
    }
  }

  /* ===== 写真の選択とトリミング =====
     選択した画像を丸い枠の中でドラッグ移動・スライダーでの拡大縮小により
     自分で構図を決められるようにし、確定時に枠内に写っている範囲だけを
     AVATAR_OUTPUT_SIZE 四方のJPEGのdata URLとして返す。 */
  let modal = null;

  function ensureModal() {
    if (modal) return modal;
    const overlay = document.createElement("div");
    overlay.className = "cropModalOverlay";
    overlay.style.display = "none";
    overlay.innerHTML = `
      <div class="cropModalBox" role="dialog" aria-modal="true" aria-label="写真の位置を調整">
        <h3>写真の位置を調整</h3>
        <p class="cropModalDesc">ドラッグで位置を、スライダーで拡大・縮小を調整できます</p>
        <div class="cropViewport">
          <img alt="" draggable="false">
        </div>
        <input type="range" class="cropZoomSlider" min="100" max="300" value="100">
        <div class="cropModalActions">
          <button type="button" data-action="cancel">キャンセル</button>
          <button type="button" data-action="confirm">この写真にする</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const viewport = overlay.querySelector(".cropViewport");
    const image = overlay.querySelector("img");
    const zoom = overlay.querySelector(".cropZoomSlider");

    const state = {
      naturalWidth: 0, naturalHeight: 0, baseScale: 1,
      offsetX: 0, offsetY: 0, zoom: 100,
      dragging: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0,
      resolve: null
    };

    const currentScale = () => state.baseScale * (state.zoom / 100);

    // 画像が常に丸い枠を隙間なく覆うように、オフセットの取りうる範囲を制限する
    function clampOffset() {
      const scale = currentScale();
      const minX = Math.min(0, CROP_VIEWPORT_SIZE - state.naturalWidth * scale);
      const minY = Math.min(0, CROP_VIEWPORT_SIZE - state.naturalHeight * scale);
      state.offsetX = Math.min(0, Math.max(minX, state.offsetX));
      state.offsetY = Math.min(0, Math.max(minY, state.offsetY));
    }

    function applyTransform() {
      const scale = currentScale();
      image.style.width = (state.naturalWidth * scale) + "px";
      image.style.height = (state.naturalHeight * scale) + "px";
      image.style.left = state.offsetX + "px";
      image.style.top = state.offsetY + "px";
    }

    function close(result) {
      overlay.style.display = "none";
      image.src = "";
      const resolve = state.resolve;
      state.resolve = null;
      if (resolve) resolve(result);
    }

    viewport.addEventListener("pointerdown", (e) => {
      state.dragging = true;
      viewport.classList.add("dragging");
      state.startX = e.clientX;
      state.startY = e.clientY;
      state.startOffsetX = state.offsetX;
      state.startOffsetY = state.offsetY;
      viewport.setPointerCapture(e.pointerId);
    });

    viewport.addEventListener("pointermove", (e) => {
      if (!state.dragging) return;
      state.offsetX = state.startOffsetX + (e.clientX - state.startX);
      state.offsetY = state.startOffsetY + (e.clientY - state.startY);
      clampOffset();
      applyTransform();
    });

    const endDrag = () => {
      state.dragging = false;
      viewport.classList.remove("dragging");
    };
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);

    zoom.addEventListener("input", () => {
      const oldScale = currentScale();
      state.zoom = Number(zoom.value);
      const newScale = currentScale();
      // 枠の中心が指す画像上の位置を、ズーム後も変わらないようにする
      const center = CROP_VIEWPORT_SIZE / 2;
      const imgX = (center - state.offsetX) / oldScale;
      const imgY = (center - state.offsetY) / oldScale;
      state.offsetX = center - imgX * newScale;
      state.offsetY = center - imgY * newScale;
      clampOffset();
      applyTransform();
    });

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(null));
    overlay.querySelector('[data-action="confirm"]').addEventListener("click", () => {
      const scale = currentScale();
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_OUTPUT_SIZE;
      canvas.height = AVATAR_OUTPUT_SIZE;
      canvas.getContext("2d").drawImage(
        image,
        -state.offsetX / scale, -state.offsetY / scale,
        CROP_VIEWPORT_SIZE / scale, CROP_VIEWPORT_SIZE / scale,
        0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE
      );
      close(canvas.toDataURL("image/jpeg", 0.7));
    });

    modal = {
      open(dataUrl) {
        return new Promise((resolve) => {
          state.resolve = resolve;
          image.onload = () => {
            state.naturalWidth = image.naturalWidth;
            state.naturalHeight = image.naturalHeight;
            // 「cover」相当（枠より小さい辺のほうを基準に拡大し、隙間ができないようにする）
            state.baseScale = Math.max(
              CROP_VIEWPORT_SIZE / state.naturalWidth,
              CROP_VIEWPORT_SIZE / state.naturalHeight
            );
            state.zoom = 100;
            zoom.value = 100;
            state.offsetX = (CROP_VIEWPORT_SIZE - state.naturalWidth * state.baseScale) / 2;
            state.offsetY = (CROP_VIEWPORT_SIZE - state.naturalHeight * state.baseScale) / 2;
            applyTransform();
            overlay.style.display = "flex";
          };
          image.onerror = () => close(null);
          image.src = dataUrl;
        });
      }
    };
    return modal;
  }

  // ファイル選択→トリミングまでを行い、確定したら画像のdata URLを、
  // キャンセルされたらnullを返す。画像以外が選ばれた場合はエラーにする。
  function pickAndCropAvatar() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener("change", () => {
        const file = input.files[0];
        input.remove();
        if (!file) return resolve(null);
        if (!file.type.startsWith("image/")) {
          return reject(new Error("画像ファイルを選択してください"));
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
        reader.onload = () => ensureModal().open(reader.result).then(resolve);
        reader.readAsDataURL(file);
      });
      input.click();
    });
  }

  window.VOCABOOST_PROFILE = {
    BIO_MAX_LENGTH,
    USERNAME_MAX_LENGTH,
    saveUsername,
    saveBio,
    savePhoto,
    normalizeBio,
    pickAndCropAvatar
  };
})();
